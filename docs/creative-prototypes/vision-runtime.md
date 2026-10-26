# Local CLIP runtime setup

Setup executed 2026-10-26 under ignored runs/vision-screen; this document preserves its reproducible commands. Public Hugging Face assets only; no API key, paid API, remote model code, or simulation run was used.

## Runtime and packages

- Python: 3.12.4, arm64, `/Users/nicholas/.asdf/installs/python/3.12.4/bin/python3`
- Isolated environment: `runs/vision-screen/.venv`
- Resolved versions: torch 2.14.1; transformers 5.20.2; Pillow 13.0.0; safetensors 0.8.0; huggingface-hub 2.3.0; NumPy 2.5.4.

Exact setup commands (from the repository root):

```sh
/Users/nicholas/.asdf/installs/python/3.12.4/bin/python3 -m venv runs/vision-screen/.venv
runs/vision-screen/.venv/bin/python -m pip install --disable-pip-version-check --index-url https://pypi.org/simple torch==2.14.1 transformers==5.20.2 pillow==13.0.0 safetensors==0.8.0 huggingface_hub==2.3.0
```

## Model assets

- Repository: `openai/clip-vit-base-patch32`
- Resolved revision: `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268`
- The revision has `pytorch_model.bin` and no safetensors weights. Downloaded that single weight format (605,247,071 bytes, about 577 MiB), not the Flax or TensorFlow weights.
- Assets are in `runs/vision-screen/model`. SHA-256:

| File | Bytes | SHA-256 |
|---|---:|---|
| `config.json` | 4,186 | `b575ef3c36f2a057fa19e221650105052d61cc9c1a972ec15019c6261ec98770` |
| `merges.txt` | 524,657 | `f526393189112391ce6f9795d4695f704121ce452c3aad1f5335cc41337eba85` |
| `preprocessor_config.json` | 316 | `910e70b3956ac9879ebc90b22fb3bc8a75b6a0677814500101a4c072bd7857bd` |
| `pytorch_model.bin` | 605,247,071 | `a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f` |
| `special_tokens_map.json` | 389 | `f8c0d6c39aee3f8431078ef6646567b0aba7f2246e9c54b8b99d55c22b707cbf` |
| `tokenizer.json` | 2,224,041 | `b556ac8c99757ffb677208af34bc8c6721572114111a6e0aaf5fa69ff0b8d842` |
| `tokenizer_config.json` | 592 | `34b7336e4bee12e0a9730eaf5189f582ef3c3eea5027f65730e5717256755aad` |
| `vocab.json` | 862,328 | `5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363` |

Exact pinned download command:

```sh
runs/vision-screen/.venv/bin/python -c 'from huggingface_hub import snapshot_download; p=snapshot_download(repo_id="openai/clip-vit-base-patch32", revision="3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268", local_dir="runs/vision-screen/model", allow_patterns=["config.json","merges.txt","preprocessor_config.json","pytorch_model.bin","special_tokens_map.json","tokenizer.json","tokenizer_config.json","vocab.json"]); print(p)'
```

## Offline CPU inference check

Loaded `AutoProcessor` and `CLIPModel` from the local directory with `local_files_only=True`; model loading explicitly used `use_safetensors=False, weights_only=True`, then moved it to CPU. A synthetic 224×224 black image with a red circle ranked “a red circle on a black background” above “a blue triangle on a white background”. Normalized image/text embedding cosine scores were 0.308063 and 0.237361, respectively. This verifies local model and processor loading plus image/text scoring; it does not measure quality on rendered simulation clips.

The check used this code (from the repository root):

```sh
runs/vision-screen/.venv/bin/python - <<'PY'
import torch
from PIL import Image, ImageDraw
from transformers import AutoProcessor, CLIPModel

path = "runs/vision-screen/model"
torch.set_num_threads(2)
processor = AutoProcessor.from_pretrained(path, local_files_only=True)
model = CLIPModel.from_pretrained(path, local_files_only=True, use_safetensors=False, weights_only=True).to("cpu").eval()
image = Image.new("RGB", (224, 224), "black")
ImageDraw.Draw(image).ellipse((64, 64, 160, 160), fill=(240, 30, 30))
texts = ["a red circle on a black background", "a blue triangle on a white background"]
inputs = processor(text=texts, images=image, return_tensors="pt", padding=True)
with torch.inference_mode():
    output = model(**inputs)
    image_embedding = torch.nn.functional.normalize(output.image_embeds, dim=-1)
    text_embedding = torch.nn.functional.normalize(output.text_embeds, dim=-1)
    scores = (image_embedding @ text_embedding.T).squeeze(0)
for text, score in zip(texts, scores.tolist()):
    print(f"cosine={score:.6f}\t{text}")
print("top_match=" + texts[int(scores.argmax())])
PY
```

## Provenance limits

The scorer configures4 intra-op and1 inter-op CPU threads; the accepted artifact does not retain those thread counts or a CPU model name as fields (it records architecture). The scorer source records the thread settings. The frozen-frame check repeats one representative fixture, cal-120-layout0-12, twice; it is not a check across every target or any temporal understanding.
