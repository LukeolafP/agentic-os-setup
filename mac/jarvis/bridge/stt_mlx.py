"""Fast speech-to-text for Petra: NVIDIA Parakeet TDT 0.6B v2 on this Mac's GPU (mlx-audio).

About 0.1 s to transcribe a 6 s question on the M1 Pro, against about 1 s for faster-whisper
small on the CPU, at the same accuracy on English. Runs in ~/Coding/jarvis/.tts-venv.
Same line protocol as stt_worker.py: {"id", "path"} in, {"id", "text"} or {"id", "error"} out.
Browser audio (webm/ogg/mp4) is converted to 16 kHz mono WAV with ffmpeg first.
"""
import json
import os
import subprocess
import sys

MODEL = os.environ.get("GTD_STT_MLX_MODEL", "mlx-community/parakeet-tdt-0.6b-v2")
FFMPEG = next((p for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg") if p == "ffmpeg" or os.path.exists(p)), "ffmpeg")


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


try:
    from mlx_audio.stt.utils import load_model

    model = load_model(MODEL)
    # the first transcription after loading pays a one-off compile (~3 s): pay it now, not on Luke's first question
    import numpy as np
    import soundfile as sf
    _warm = "/tmp/gtd-stt-warmup.wav"
    sf.write(_warm, (np.sin(np.linspace(0, 440 * 6.283, 16000)) * 0.05).astype("float32"), 16000)
    model.generate(_warm)
    out({"ready": True, "model": MODEL.split("/")[-1]})
except Exception as e:  # noqa: BLE001 - the bridge falls back to faster-whisper
    out({"ready": False, "error": str(e)})
    sys.exit(1)

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    rid, src = req.get("id"), req.get("path")
    wav = src + ".16k.wav"
    try:
        subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-i", src, "-ar", "16000", "-ac", "1", wav], check=True)
        text = (model.generate(wav).text or "").strip()
        out({"id": rid, "text": text})
    except Exception as e:  # noqa: BLE001
        out({"id": rid, "error": str(e)})
    finally:
        try:
            os.remove(wav)
        except OSError:
            pass
