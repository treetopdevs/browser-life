#!/usr/bin/env python3
"""Score generated 128x128 PPM frames with the pinned local CLIP model.

Pure validation and aggregation helpers are intentionally separate from model
inference so unit tests can exercise them without presenting synthetic scores
as real vision validation.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import re
import statistics
import sys
import tempfile
import time
import platform
from pathlib import Path
from typing import Any, Iterable


PROMPTS = (
    "many small separated clusters of colored dots on a dark background",
    "one large cluster of colored dots on a dark background",
    "colored dots spread uniformly across a dark background",
)
MODEL_REPOSITORY = "openai/clip-vit-base-patch32"
MODEL_REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"
MODEL_ASSETS = {
    "config.json": "b575ef3c36f2a057fa19e221650105052d61cc9c1a972ec15019c6261ec98770",
    "merges.txt": "f526393189112391ce6f9795d4695f704121ce452c3aad1f5335cc41337eba85",
    "preprocessor_config.json": "910e70b3956ac9879ebc90b22fb3bc8a75b6a0677814500101a4c072bd7857bd",
    "pytorch_model.bin": "a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f",
    "special_tokens_map.json": "f8c0d6c39aee3f8431078ef6646567b0aba7f2246e9c54b8b99d55c22b707cbf",
    "tokenizer.json": "b556ac8c99757ffb677208af34bc8c6721572114111a6e0aaf5fa69ff0b8d842",
    "tokenizer_config.json": "34b7336e4bee12e0a9730eaf5189f582ef3c3eea5027f65730e5717256755aad",
    "vocab.json": "5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363",
}
IMAGE_WIDTH = 128
IMAGE_HEIGHT = 128
IMAGE_RGB_BYTES = IMAGE_WIDTH * IMAGE_HEIGHT * 3
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_ITEMS = 64
MAX_FRAMES_PER_ITEM = 256
MAX_TOTAL_FRAMES = 1920
MAX_PPM_BYTES = 1024 * 1024
MAX_OUTPUT_BYTES = 32 * 1024 * 1024
INFERENCE_BATCH_SIZE = 8
CPU_THREADS = 4
CPU_INTEROP_THREADS = 1
STAGE_TIMEOUT_SECONDS = 20 * 60
HASH_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


class VisionScoreError(ValueError):
    """An invalid input or unavailable pinned local scoring resource."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise VisionScoreError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise VisionScoreError(f"invalid non-finite JSON number: {value}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_manifest(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_MANIFEST_BYTES:
        raise VisionScoreError(f"manifest exceeds {MAX_MANIFEST_BYTES} bytes")
    try:
        value = json.loads(
            raw,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VisionScoreError(f"manifest is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise VisionScoreError("manifest must be a JSON object")
    return value


def _exact_keys(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise VisionScoreError(f"{label} must be an object")
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise VisionScoreError(f"{label} keys mismatch (missing={missing}, extra={extra})")
    return value


def _safe_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 160:
        raise VisionScoreError(f"{label} must be a non-empty string of at most 160 characters")
    if any(ord(char) < 32 for char in value):
        raise VisionScoreError(f"{label} must not contain control characters")
    return value


def validate_manifest(value: dict[str, Any]) -> list[dict[str, Any]]:
    _exact_keys(value, {"schemaVersion", "prompts", "items"}, "manifest")
    if value["schemaVersion"] != 1 or isinstance(value["schemaVersion"], bool):
        raise VisionScoreError("schemaVersion must be the integer 1")
    prompts = value["prompts"]
    if not isinstance(prompts, list) or len(prompts) != 3 or tuple(prompts) != PROMPTS:
        raise VisionScoreError("prompts must exactly match the three pinned strings, in target/one/uniform order")
    items = value["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise VisionScoreError(f"items must contain 1 to {MAX_ITEMS} entries")

    seen_ids: set[str] = set()
    total_frames = 0
    validated: list[dict[str, Any]] = []
    for item_index, raw_item in enumerate(items):
        item = _exact_keys(raw_item, {"id", "frames"}, f"items[{item_index}]")
        item_id = _safe_id(item["id"], f"items[{item_index}].id")
        if item_id in seen_ids:
            raise VisionScoreError(f"duplicate item id: {item_id}")
        seen_ids.add(item_id)
        frames = item["frames"]
        if not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES_PER_ITEM:
            raise VisionScoreError(f"items[{item_index}].frames must contain 1 to {MAX_FRAMES_PER_ITEM} frames")
        total_frames += len(frames)
        if total_frames > MAX_TOTAL_FRAMES:
            raise VisionScoreError(f"manifest exceeds {MAX_TOTAL_FRAMES} total frames")
        checked_frames: list[dict[str, str]] = []
        for frame_index, raw_frame in enumerate(frames):
            frame = _exact_keys(raw_frame, {"path", "sha256"}, f"items[{item_index}].frames[{frame_index}]")
            frame_path = frame["path"]
            if not isinstance(frame_path, str) or not frame_path or len(frame_path) > 1024:
                raise VisionScoreError(f"items[{item_index}].frames[{frame_index}].path must be a non-empty relative path")
            rel = Path(frame_path)
            if rel.is_absolute() or ".." in rel.parts:
                raise VisionScoreError(f"frame path must stay inside the manifest folder: {frame_path}")
            digest = frame["sha256"]
            if not isinstance(digest, str) or not HASH_PATTERN.fullmatch(digest):
                raise VisionScoreError(f"items[{item_index}].frames[{frame_index}].sha256 must be lowercase SHA-256 hex")
            checked_frames.append({"path": frame_path, "sha256": digest})
        validated.append({"id": item_id, "frames": checked_frames})
    return validated


def resolve_frame_path(manifest_dir: Path, relative_path: str) -> Path:
    root = manifest_dir.resolve(strict=True)
    path = (root / relative_path).resolve(strict=True)
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise VisionScoreError(f"frame path resolves outside the manifest folder: {relative_path}") from exc
    if not path.is_file():
        raise VisionScoreError(f"frame path is not a regular file: {relative_path}")
    if path.stat().st_size > MAX_PPM_BYTES:
        raise VisionScoreError(f"PPM exceeds {MAX_PPM_BYTES} bytes: {relative_path}")
    return path


def load_rgb_frame(path: Path, expected_sha256: str) -> bytes:
    from PIL import Image

    try:
        with Image.open(path) as image:
            if image.format != "PPM":
                raise VisionScoreError(f"expected a PPM frame: {path.name}")
            if image.size != (IMAGE_WIDTH, IMAGE_HEIGHT):
                raise VisionScoreError(f"frame must be exactly {IMAGE_WIDTH}x{IMAGE_HEIGHT}: {path.name}")
            raw_rgb = image.convert("RGB").tobytes()
    except VisionScoreError:
        raise
    except Exception as exc:
        raise VisionScoreError(f"could not decode PPM frame {path.name}: {exc}") from exc
    if len(raw_rgb) != IMAGE_RGB_BYTES:
        raise VisionScoreError(f"decoded frame has an unexpected RGB byte count: {path.name}")
    actual_sha256 = hashlib.sha256(raw_rgb).hexdigest()
    if actual_sha256 != expected_sha256:
        raise VisionScoreError(f"RGB SHA-256 mismatch for {path.name}: expected {expected_sha256}, got {actual_sha256}")
    return raw_rgb


def aggregate_margins(margins: Iterable[float]) -> dict[str, float]:
    values = [float(value) for value in margins]
    if not values:
        raise VisionScoreError("cannot aggregate an empty margin series")
    if any(not math.isfinite(value) for value in values):
        raise VisionScoreError("all frame margins must be finite")
    mean_margin = statistics.fmean(values)
    std_margin = statistics.pstdev(values)
    if not math.isfinite(mean_margin) or not math.isfinite(std_margin):
        raise VisionScoreError("margin aggregate is non-finite")
    return {"meanMargin": mean_margin, "stdMargin": std_margin}


def frame_score(cosines: Iterable[float]) -> dict[str, float]:
    values = [float(value) for value in cosines]
    if len(values) != 3 or any(not math.isfinite(value) for value in values):
        raise VisionScoreError("each frame must have exactly three finite cosine scores")
    margin = values[0] - max(values[1], values[2])
    if not math.isfinite(margin):
        raise VisionScoreError("frame margin is non-finite")
    return {
        "targetCosine": values[0],
        "oneCosine": values[1],
        "uniformCosine": values[2],
        "margin": margin,
    }


def _check_deadline(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise VisionScoreError(f"scoring stage exceeded {STAGE_TIMEOUT_SECONDS // 60}-minute wall deadline")


def _model_asset_hashes(model_dir: Path) -> dict[str, str]:
    root = model_dir.resolve(strict=True)
    if not root.is_dir():
        raise VisionScoreError(f"model directory is not a directory: {root}")
    actual: dict[str, str] = {}
    for name, expected in MODEL_ASSETS.items():
        path = root / name
        if not path.is_file():
            raise VisionScoreError(f"pinned model asset is missing: {name}")
        digest = sha256_file(path)
        if digest != expected:
            raise VisionScoreError(f"pinned model asset hash mismatch for {name}: {digest}")
        actual[name] = digest
    return actual


def _processor_settings(processor: Any) -> dict[str, Any]:
    from PIL import Image

    image_processor = processor.image_processor
    size = image_processor.size
    crop_size = image_processor.crop_size
    settings = {
        "inputColorMode": "RGB",
        "resize": {
            "enabled": bool(image_processor.do_resize),
            "shortestEdge": int(size["shortest_edge"]),
            "interpolation": "bicubic" if image_processor.resample == Image.Resampling.BICUBIC else str(image_processor.resample),
        },
        "centerCrop": {
            "enabled": bool(image_processor.do_center_crop),
            "height": int(crop_size["height"]),
            "width": int(crop_size["width"]),
        },
        "rescale": {
            "enabled": bool(image_processor.do_rescale),
            "factor": float(image_processor.rescale_factor),
        },
        "normalize": {
            "enabled": bool(image_processor.do_normalize),
            "mean": [float(x) for x in image_processor.image_mean],
            "std": [float(x) for x in image_processor.image_std],
        },
    }
    if settings["resize"]["shortestEdge"] != 224 or settings["centerCrop"] != {"enabled": True, "height": 224, "width": 224}:
        raise VisionScoreError("pinned processor settings do not match the required 224px bicubic resize and center crop")
    if image_processor.resample != Image.Resampling.BICUBIC:
        raise VisionScoreError("pinned processor interpolation is not bicubic")
    return settings


def _load_model(model_dir: Path, deadline: float) -> tuple[Any, Any, dict[str, Any]]:
    _check_deadline(deadline)
    assets = _model_asset_hashes(model_dir)
    import torch
    from transformers import AutoProcessor, CLIPModel

    torch.set_num_threads(CPU_THREADS)
    torch.set_num_interop_threads(CPU_INTEROP_THREADS)
    model_path = str(model_dir.resolve(strict=True))
    processor = AutoProcessor.from_pretrained(
        model_path,
        local_files_only=True,
        trust_remote_code=False,
    )
    model = CLIPModel.from_pretrained(
        model_path,
        local_files_only=True,
        trust_remote_code=False,
        use_safetensors=False,
        weights_only=True,
    ).to("cpu").eval()
    _check_deadline(deadline)
    settings = _processor_settings(processor)
    settings["batchSize"] = INFERENCE_BATCH_SIZE
    settings["torchThreads"] = CPU_THREADS
    settings["torchInteropThreads"] = CPU_INTEROP_THREADS
    return processor, model, assets


def score_manifest(manifest_path: Path, output_path: Path, model_dir: Path) -> dict[str, Any]:
    deadline = time.monotonic() + STAGE_TIMEOUT_SECONDS
    manifest_path = manifest_path.resolve(strict=True)
    manifest_raw = manifest_path.read_bytes()
    if len(manifest_raw) > MAX_MANIFEST_BYTES:
        raise VisionScoreError(f"manifest exceeds {MAX_MANIFEST_BYTES} bytes")
    manifest = decode_manifest(manifest_raw)
    items = validate_manifest(manifest)
    manifest_dir = manifest_path.parent
    output_path = output_path.absolute()
    if output_path.exists():
        raise VisionScoreError(f"refusing to overwrite existing output: {output_path}")
    processor, model, model_assets = _load_model(model_dir, deadline)

    import torch
    from PIL import Image

    text_inputs = processor.tokenizer(
        list(PROMPTS),
        return_tensors="pt",
        padding=True,
        truncation=True,
    )
    with torch.inference_mode():
        text_output = model.get_text_features(**text_inputs)
        if hasattr(text_output, "pooler_output"):
            text_embeddings = text_output.pooler_output
        elif hasattr(text_output, "last_hidden_state"):
            text_embeddings = text_output.last_hidden_state[:, 0, :]
        else:
            text_embeddings = text_output
        text_embeddings = torch.nn.functional.normalize(text_embeddings.to(dtype=torch.float32), dim=-1)
    if text_embeddings.shape[0] != 3 or not bool(torch.isfinite(text_embeddings).all()):
        raise VisionScoreError("text encoder returned invalid embeddings")

    frame_records: dict[tuple[int, int], dict[str, Any]] = {}
    batch_refs: list[tuple[int, int, dict[str, str]]] = []
    batch_images: list[Image.Image] = []

    def score_batch() -> None:
        nonlocal batch_refs, batch_images
        if not batch_images:
            return
        _check_deadline(deadline)
        image_inputs = processor.image_processor(images=batch_images, return_tensors="pt")
        with torch.inference_mode():
            image_output = model.get_image_features(**image_inputs)
            if hasattr(image_output, "pooler_output"):
                image_embeddings = image_output.pooler_output
            elif hasattr(image_output, "last_hidden_state"):
                image_embeddings = image_output.last_hidden_state[:, 0, :]
            else:
                image_embeddings = image_output
            image_embeddings = torch.nn.functional.normalize(image_embeddings.to(dtype=torch.float32), dim=-1)
            cosine_matrix = image_embeddings @ text_embeddings.T
        if cosine_matrix.shape != (len(batch_refs), 3) or not bool(torch.isfinite(cosine_matrix).all()):
            raise VisionScoreError("image/text encoder returned invalid cosine scores")
        for row_index, (item_index, frame_index, source_frame) in enumerate(batch_refs):
            scores = [float(x) for x in cosine_matrix[row_index].tolist()]
            frame_records[(item_index, frame_index)] = {
                "path": source_frame["path"],
                "sha256": source_frame["sha256"],
                **frame_score(scores),
            }
        batch_refs = []
        batch_images = []

    for item_index, item in enumerate(items):
        for frame_index, source_frame in enumerate(item["frames"]):
            _check_deadline(deadline)
            frame_path = resolve_frame_path(manifest_dir, source_frame["path"])
            raw_rgb = load_rgb_frame(frame_path, source_frame["sha256"])
            batch_images.append(Image.frombytes("RGB", (IMAGE_WIDTH, IMAGE_HEIGHT), raw_rgb))
            batch_refs.append((item_index, frame_index, source_frame))
            if len(batch_images) == INFERENCE_BATCH_SIZE:
                score_batch()
    score_batch()
    _check_deadline(deadline)

    output_items: list[dict[str, Any]] = []
    for item_index, item in enumerate(items):
        scores = [frame_records[(item_index, frame_index)] for frame_index in range(len(item["frames"]))]
        aggregates = aggregate_margins(frame["margin"] for frame in scores)
        output_items.append({"id": item["id"], "frames": scores, **aggregates})

    def pkg_version(name: str) -> str:
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError as exc:
            raise VisionScoreError(f"required package is missing from the scorer environment: {name}") from exc

    result = {
        "schemaVersion": 1,
        "method": "CLIP cosine similarity; frame margin = targetCosine - max(oneCosine, uniformCosine); stdMargin is population standard deviation (ddof=0)",
        "prompts": list(PROMPTS),
        "provenance": {
            "manifestSha256": hashlib.sha256(manifest_raw).hexdigest(),
            "scorerSourceSha256": sha256_file(Path(__file__).resolve()),
            "modelRepository": MODEL_REPOSITORY,
            "modelRevision": MODEL_REVISION,
            "modelAssetSha256": model_assets,
            "device": "cpu",
            "dtype": "float32",
            "python": sys.version.split()[0],
            "architecture": platform.machine(),
            "remoteCode": False,
            "weightsOnly": True,
            "packages": {
                "torch": pkg_version("torch"),
                "transformers": pkg_version("transformers"),
                "Pillow": pkg_version("Pillow"),
                "safetensors": pkg_version("safetensors"),
                "huggingface-hub": pkg_version("huggingface-hub"),
                "numpy": pkg_version("numpy"),
            },
            "processor": _processor_settings(processor),
            "limits": {
                "batchSize": INFERENCE_BATCH_SIZE,
                "stageTimeoutSeconds": STAGE_TIMEOUT_SECONDS,
                "maxItems": MAX_ITEMS,
                "maxFrames": MAX_TOTAL_FRAMES,
                "maxOutputBytes": MAX_OUTPUT_BYTES,
            },
        },
        "items": output_items,
    }
    _check_deadline(deadline)
    try:
        output_bytes = (json.dumps(result, indent=2, allow_nan=False) + "\n").encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise VisionScoreError(f"could not serialize complete score output: {exc}") from exc
    if len(output_bytes) > MAX_OUTPUT_BYTES:
        raise VisionScoreError(f"score output exceeds {MAX_OUTPUT_BYTES} bytes")
    _atomic_write_new(output_path, output_bytes)
    return result


def _atomic_write_new(output_path: Path, content: bytes) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        raise VisionScoreError(f"refusing to overwrite existing output: {output_path}")
    file_descriptor = -1
    temporary_path: Path | None = None
    try:
        file_descriptor, raw_temp_path = tempfile.mkstemp(prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent)
        temporary_path = Path(raw_temp_path)
        with os.fdopen(file_descriptor, "wb") as stream:
            file_descriptor = -1
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if output_path.exists():
            raise VisionScoreError(f"refusing to overwrite existing output: {output_path}")
        os.link(temporary_path, output_path)
        temporary_path.unlink()
    except FileExistsError as exc:
        raise VisionScoreError(f"refusing to overwrite existing output: {output_path}") from exc
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        score_manifest(args.manifest, args.output, args.model_dir)
    except (VisionScoreError, OSError) as exc:
        print(f"vision-screen scorer: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
