"""Whisper 常驻内存服务器 —— 高质量转写版
通过 stdin/stdout 与 Node.js 通信，模型只加载一次，所有请求复用
协议：每行一个 JSON，支持进度上报
  握手: {"type": "ready", "protocol": 1}；请求与响应均携带 request_id
  请求: {"request_id": "...", "audio_path": "...", "model": "medium", "language": null}
  响应: {"type": "progress", "percent": 50} （多次）
        {"type": "result", "text": "...", "segments": [...], "language": "zh"} （最终）

本批保留既有推理参数，不承诺修复多语言识别准确率。
"""
import sys
import os
import json
from whisper_audio import prepared_audio
import warnings

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
warnings.filterwarnings("ignore", message=".*huggingface_hub.*")
warnings.filterwarnings("ignore", message=".*unauthenticated.*")

# CUDA DLL 搜索路径
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

_loaded_models: dict[str, WhisperModel] = {}

def _detect_device() -> str:
    try:
        WhisperModel("tiny", device="cuda", compute_type="float16")
        sys.stderr.write("[whisper_server] CUDA 可用\n")
        sys.stderr.flush()
        return "cuda"
    except Exception:
        sys.stderr.write("[whisper_server] 降级 CPU\n")
        sys.stderr.flush()
        return "cpu"

DEVICE = _detect_device()
COMPUTE_TYPE = "int8_float16" if DEVICE == "cuda" else "int8"

def get_model(model_name: str) -> WhisperModel:
    if model_name not in _loaded_models:
        sys.stderr.write(f"[whisper_server] 加载模型: {model_name} ({DEVICE})\n")
        sys.stderr.flush()
        _loaded_models[model_name] = WhisperModel(
            model_name, device=DEVICE, compute_type=COMPUTE_TYPE
        )
    return _loaded_models[model_name]

def send(data: dict):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def transcribe(audio_path: str, model_name: str = "medium", language: str = None, on_progress=None) -> dict:
    """保留既有推理参数；异常时也清理本次转换文件。"""
    model = get_model(model_name)
    with prepared_audio(audio_path) as processed_path:
        if on_progress:
            on_progress(0)
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
        if on_progress:
            on_progress(100)
    return {"text": " ".join(full_text), "segments": segments, "language": info.language}


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    default_model = sys.argv[1] if len(sys.argv) > 1 else "medium"
    sys.stderr.write(f"[whisper_server] 预加载: {default_model}\n")
    sys.stderr.flush()
    get_model(default_model)
    send({"type": "ready", "protocol": 1})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            req = json.loads(line)
            if req.get("action") == "shutdown":
                break
            request_id = req.get("request_id")
            if not isinstance(request_id, str) or not 1 <= len(request_id) <= 64:
                raise ValueError("请求 ID 不合法")
            result = transcribe(req["audio_path"], req.get("model", default_model), req.get("language"),
                                lambda percent: send({"type": "progress", "request_id": request_id, "percent": percent}))
            send({"type": "result", "request_id": request_id, **result})
        except Exception as error:
            sys.stderr.write(f"[whisper_server] 转写失败: {type(error).__name__}\n")
            sys.stderr.flush()
            send({"type": "error", "request_id": request_id, "error": "本地转写失败"})


if __name__ == "__main__":
    main()
