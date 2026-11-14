# CLIP image embeddings for rendered frames: the observer of
# docs/soup-asal-calibration-2026-10-31.md. Reads PNGs only; never touches a
# simulation. Run in an isolated environment with pinned versions:
#
#   uv run --no-project --python 3.12 --with open_clip_torch==2.32.0 --with torch==2.7.1 --with pillow \
#     tools/observe/clip_embed.py --out runs/observe/g1.json [--recolor brg] FRAME.png ...
#
# Each frame is letterboxed onto a black square (so nothing is cropped), resized
# to the model's input size with bicubic resampling and normalised as the model
# expects. Output JSON: model, versions, a SHA-256 over the model parameters
# (state-dict order, float32 little-endian), the recolouring, and per frame the
# file name and its L2-normalised embedding.
import argparse, hashlib, json, sys

import numpy as np
import open_clip
import torch
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument("--out", required=True)
p.add_argument("--model", default="ViT-B-32-quickgelu")  # OpenAI weights were trained with QuickGELU
p.add_argument("--pretrained", default="openai")
p.add_argument("--recolor", choices=["none", "brg"], default="none", help="brg: channels R,G,B -> B,R,G")
p.add_argument("--batch", type=int, default=16)
p.add_argument("frames", nargs="+")
a = p.parse_args()

torch.manual_seed(0)
model, _, _ = open_clip.create_model_and_transforms(a.model, pretrained=a.pretrained)
model.eval()
cfg = model.visual.preprocess_cfg if hasattr(model.visual, "preprocess_cfg") else {}
size = model.visual.image_size if isinstance(model.visual.image_size, int) else model.visual.image_size[0]
mean = np.array(cfg.get("mean", open_clip.OPENAI_DATASET_MEAN), dtype=np.float32)
std = np.array(cfg.get("std", open_clip.OPENAI_DATASET_STD), dtype=np.float32)

h = hashlib.sha256()
for _, t in model.state_dict().items():
    h.update(t.detach().to(torch.float32).cpu().numpy().astype("<f4").tobytes())
digest = h.hexdigest()

def load(path: str) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    if a.recolor == "brg":
        r, g, b = im.split()
        im = Image.merge("RGB", (b, r, g))
    side = max(im.size)
    sq = Image.new("RGB", (side, side), (0, 0, 0))
    sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
    sq = sq.resize((size, size), Image.BICUBIC)
    x = (np.asarray(sq, dtype=np.float32) / 255.0 - mean) / std
    return x.transpose(2, 0, 1)

device = "cpu"  # CPU keeps embeddings reproducible across runs of this script
model.to(device)
out = []
with torch.no_grad():
    for i in range(0, len(a.frames), a.batch):
        chunk = a.frames[i : i + a.batch]
        x = torch.from_numpy(np.stack([load(f) for f in chunk])).to(device)
        e = model.encode_image(x)
        e = e / e.norm(dim=-1, keepdim=True)
        for f, v in zip(chunk, e.cpu().numpy()):
            out.append({"frame": f.split("/")[-1], "embedding": [round(float(z), 7) for z in v]})
        print(f"{min(i + a.batch, len(a.frames))}/{len(a.frames)}", file=sys.stderr)

meta = {
    "model": a.model, "pretrained": a.pretrained, "open_clip": open_clip.__version__, "torch": torch.__version__,
    "params_sha256": digest, "recolor": a.recolor, "input_size": size, "preprocess": "letterbox black square, bicubic resize, model mean/std",
}
with open(a.out, "w") as fh:
    json.dump({"meta": meta, "frames": out}, fh)
print(json.dumps(meta))
