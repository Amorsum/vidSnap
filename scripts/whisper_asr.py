"""Whisper ASR 脚本 —— 高质量转写版（降级用）"""
import sys, os, json, subprocess, tempfile, warnings

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
warnings.filterwarnings("ignore")

_cuda_dll_dirs = [
    os.path.join(os.path.dirname(__file__), "_vendor", "ctranslate2"),
    os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Python", "Python312", "site-packages", "nvidia", "cublas", "bin"),
    os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Python", "Python312", "site-packages", "nvidia", "cuda_nvrtc", "bin"),
]
for d in _cuda_dll_dirs:
    if os.path.isdir(d):
        os.add_dll_directory(d)
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "_vendor"))
from faster_whisper import WhisperModel

def detect_device():
    try:
        WhisperModel("tiny", device="cuda", compute_type="float16")
        return ("cuda", "int8_float16")
    except Exception:
        return ("cpu", "int8")

DEVICE, COMPUTE_TYPE = detect_device()

def preprocess_audio(audio_path):
    fd, p = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    subprocess.run(["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", p], capture_output=True)
    return p

def transcribe(audio_path, model_name="large-v3", language=None):
    model = WhisperModel(model_name, device=DEVICE, compute_type=COMPUTE_TYPE)
    processed_path = preprocess_audio(audio_path)

    segments_iter, info = model.transcribe(
        processed_path, language=language,
        beam_size=5, best_of=5, patience=2,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8],
        compression_ratio_threshold=2.4, no_speech_threshold=0.6,
        word_timestamps=True, vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300),
        condition_on_previous_text=True,
    )

    segments, full_text = [], []
    for seg in segments_iter:
        segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        full_text.append(seg.text.strip())

    try: os.unlink(processed_path)
    except OSError: pass

    return {"text": " ".join(full_text), "segments": segments, "language": info.language}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python whisper_asr.py <audio_path> <model> [language]"}))
        sys.exit(1)
    print(f"Device: {DEVICE}", file=sys.stderr)
    result = transcribe(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    print(json.dumps(result, ensure_ascii=False))