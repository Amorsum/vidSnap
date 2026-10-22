"""常驻与单次 ASR 共用的有界音频预处理，不在异常时遗留 WAV。"""
from contextlib import contextmanager
import os
import subprocess
import tempfile


@contextmanager
def prepared_audio(audio_path):
    fd, output = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        subprocess.run(["ffmpeg", "-y", "-protocol_whitelist", "file,pipe", "-i", audio_path,
                        "-ar", "16000", "-ac", "1", output], capture_output=True, check=True, timeout=60)
        yield output
    finally:
        try:
            os.unlink(output)
        except FileNotFoundError:
            pass
