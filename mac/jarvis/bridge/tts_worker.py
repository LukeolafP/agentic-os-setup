"""Petra's voice: Voxtral TTS (Mistral, 4B, MLX 4-bit) on this Mac's GPU.

Runs in ~/Coding/jarvis/.tts-venv (mlx-audio). Reads one JSON request per line on stdin,
{"id", "text", "voice"}, and streams the audio back as it is generated, one JSON line per
chunk: {"id", "seq", "audio": <base64 16-bit WAV>} and finally {"id", "done": true}, or
{"id", "error"}. The model loads once and stays warm.

Licence: Voxtral weights are CC BY-NC 4.0. Luke uses Petra personally, not commercially.
"""
import base64
import io
import json
import os
import sys

MODEL = os.environ.get("GTD_VOXTRAL_MODEL", "mlx-community/Voxtral-4B-TTS-2603-mlx-4bit")
INTERVAL = float(os.environ.get("GTD_TTS_CHUNK_S", "0.4"))   # seconds of audio per chunk: 0.4 gets the first sound out in ~0.95 s


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


try:
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load

    model = load(MODEL)
    list(model.generate(text="Ready.", voice="casual_female"))   # compile once, so the first real line is fast
    out({"ready": True, "model": MODEL})
except Exception as e:  # noqa: BLE001 - report it, the bridge falls back to Kokoro
    out({"ready": False, "error": str(e)})
    sys.exit(1)


def wav_b64(audio):
    buf = io.BytesIO()
    sf.write(buf, np.clip(np.asarray(audio, dtype=np.float32), -1, 1), 24000, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()


for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    rid, text, voice = req.get("id"), str(req.get("text", "")).strip(), req.get("voice") or "casual_female"
    if not text:
        out({"id": rid, "done": True})
        continue
    try:
        seq = 0
        for r in model.generate(text=text, voice=voice, stream=True, streaming_interval=INTERVAL):
            out({"id": rid, "seq": seq, "audio": wav_b64(r.audio)})
            seq += 1
        out({"id": rid, "done": True})
    except Exception as e:  # noqa: BLE001
        out({"id": rid, "error": str(e)})
