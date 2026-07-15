#!/bin/bash
# 下载 yt-dlp 静态二进制到 bin/ 目录（Netlify 构建时运行）

set -e

BIN_DIR="$(dirname "$0")/../bin"
mkdir -p "$BIN_DIR"

YTDLP_PATH="$BIN_DIR/yt-dlp"

if [ -f "$YTDLP_PATH" ]; then
  echo "[yt-dlp] binary already exists, skipping download"
  exit 0
fi

echo "[yt-dlp] downloading standalone binary..."
curl -L -o "$YTDLP_PATH" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x "$YTDLP_PATH"
echo "[yt-dlp] downloaded to $YTDLP_PATH"