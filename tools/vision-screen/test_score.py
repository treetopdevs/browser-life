"""Pure synthetic unit tests; these are not evidence of real CLIP inference."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from PIL import Image

import score


def valid_manifest(*, item_ids: tuple[str, ...] = ("fixture-a",), frames: int = 1) -> dict:
    return {
        "schemaVersion": 1,
        "prompts": list(score.PROMPTS),
        "items": [
            {"id": item_id, "frames": [{"path": f"frame-{i}.ppm", "sha256": "0" * 64} for i in range(frames)]}
            for item_id in item_ids
        ],
    }


class ScoreArithmeticTests(unittest.TestCase):
    def test_margin_uses_target_minus_largest_alternative(self) -> None:
        result = score.frame_score((0.51, 0.42, 0.19))
        self.assertEqual((result["targetCosine"], result["oneCosine"], result["uniformCosine"]), (0.51, 0.42, 0.19))
        self.assertAlmostEqual(result["margin"], 0.09)
        self.assertAlmostEqual(score.frame_score((0.4, 0.2, 0.5))["margin"], -0.1)

    def test_mean_and_population_standard_deviation(self) -> None:
        result = score.aggregate_margins((0.1, -0.05))
        self.assertAlmostEqual(result["meanMargin"], 0.025)
        self.assertAlmostEqual(result["stdMargin"], 0.075)

    def test_non_finite_and_empty_scores_are_rejected(self) -> None:
        with self.assertRaises(score.VisionScoreError):
            score.frame_score((0.1, float("nan"), 0.3))
        with self.assertRaises(score.VisionScoreError):
            score.aggregate_margins(())
        with self.assertRaises(score.VisionScoreError):
            score.aggregate_margins((0.1, float("inf")))


class ManifestValidationTests(unittest.TestCase):
    def test_accepts_exact_prompts_and_schema(self) -> None:
        checked = score.validate_manifest(valid_manifest())
        self.assertEqual(checked[0]["id"], "fixture-a")
        self.assertEqual(checked[0]["frames"][0]["path"], "frame-0.ppm")

    def test_rejects_prompt_drift_and_wrong_prompt_count(self) -> None:
        changed = valid_manifest()
        changed["prompts"][0] = "many dots"
        with self.assertRaisesRegex(score.VisionScoreError, "pinned strings"):
            score.validate_manifest(changed)
        changed = valid_manifest()
        changed["prompts"].pop()
        with self.assertRaisesRegex(score.VisionScoreError, "pinned strings"):
            score.validate_manifest(changed)

    def test_rejects_duplicate_ids_and_invalid_counts(self) -> None:
        with self.assertRaisesRegex(score.VisionScoreError, "duplicate item id"):
            score.validate_manifest(valid_manifest(item_ids=("same", "same")))
        with self.assertRaisesRegex(score.VisionScoreError, "1 to"):
            score.validate_manifest({"schemaVersion": 1, "prompts": list(score.PROMPTS), "items": []})
        with self.assertRaisesRegex(score.VisionScoreError, "total frames"):
            score.validate_manifest(valid_manifest(item_ids=("a", "b", "c", "d", "e", "f", "g", "h"), frames=256))

    def test_rejects_path_traversal_and_bad_hashes(self) -> None:
        changed = valid_manifest()
        changed["items"][0]["frames"][0]["path"] = "../outside.ppm"
        with self.assertRaisesRegex(score.VisionScoreError, "inside"):
            score.validate_manifest(changed)
        changed = valid_manifest()
        changed["items"][0]["frames"][0]["sha256"] = "ABC"
        with self.assertRaisesRegex(score.VisionScoreError, "lowercase SHA-256"):
            score.validate_manifest(changed)

    def test_duplicate_json_keys_and_non_finite_values_are_rejected(self) -> None:
        with self.assertRaisesRegex(score.VisionScoreError, "duplicate JSON key"):
            score.decode_manifest(b'{"schemaVersion":1,"schemaVersion":1}')
        with self.assertRaisesRegex(score.VisionScoreError, "non-finite"):
            score.decode_manifest(b'{"bad":NaN}')


class RGBFrameValidationTests(unittest.TestCase):
    def test_hashes_rgb_bytes_after_pillow_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "frame.ppm"
            image = Image.new("RGB", (128, 128), (10, 18, 24))
            image.save(path, format="PPM")
            raw_rgb = image.tobytes()
            expected_hash = hashlib.sha256(raw_rgb).hexdigest()
            self.assertEqual(score.load_rgb_frame(path, expected_hash), raw_rgb)
            with self.assertRaisesRegex(score.VisionScoreError, "SHA-256 mismatch"):
                score.load_rgb_frame(path, "0" * 64)

    def test_rejects_wrong_size_and_non_ppm(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            wrong_size = root / "wrong.ppm"
            Image.new("RGB", (64, 64)).save(wrong_size, format="PPM")
            with self.assertRaisesRegex(score.VisionScoreError, "128x128"):
                score.load_rgb_frame(wrong_size, "0" * 64)
            other_format = root / "not-ppm.ppm"
            Image.new("RGB", (128, 128)).save(other_format, format="PNG")
            with self.assertRaisesRegex(score.VisionScoreError, "expected a PPM"):
                score.load_rgb_frame(other_format, "0" * 64)


if __name__ == "__main__":
    unittest.main()
