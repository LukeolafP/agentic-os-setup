"""Local speech-to-text worker for the JARVIS bridge in GTD mode.

Reads one JSON request per line on stdin ({"id", "path"}), transcribes the audio file
with faster-whisper on the CPU, and writes {"id", "text"} or {"id", "error"} per line on
stdout. The model loads once and stays warm, so each utterance only pays decode time.
Same library and model the vault's Instagram sync already uses.
"""
import json
import os
import sys

MODEL = os.environ.get("GTD_STT_MODEL", "small")

try:
    from faster_whisper import WhisperModel
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
except Exception as e:  # noqa: BLE001 - report and keep the protocol alive
    model = None
    load_error = str(e)

print(json.dumps({"ready": model is not None, "model": MODEL}), flush=True)

# names the model would otherwise mishear in this vault
PROMPT = "Jarvis, GTD Vault, Rubric, Obsidian, Amrit, Renier, Jason, Hyros, GoHighLevel, Notion, reels, CTA."

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    rid = req.get("id")
    if model is None:
        print(json.dumps({"id": rid, "error": "speech model failed to load: " + load_error}), flush=True)
        continue
    try:
        segments, _ = model.transcribe(
            req["path"], language="en", vad_filter=True, beam_size=1, initial_prompt=PROMPT
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        print(json.dumps({"id": rid, "text": text}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"id": rid, "error": str(e)}), flush=True)
