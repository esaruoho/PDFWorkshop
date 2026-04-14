#!/bin/bash
set -e
cd "$(dirname "$0")"

echo ""
echo "  GLM-OCR MLX Server (Apple Silicon)"
echo "  ==================================="
echo ""

if [ ! -d ".venv-mlx" ]; then
  echo "  Setting up MLX environment (first run only)..."

  # Find Python 3.12 (prefer brew, fall back to PATH, else bootstrap brew install)
  PY312=""
  for cand in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12; do
    if command -v "$cand" >/dev/null 2>&1; then PY312="$cand"; break; fi
  done
  if [ -z "$PY312" ]; then
    if command -v brew >/dev/null 2>&1; then
      echo "  Installing python@3.12 via Homebrew..."
      brew install python@3.12
      PY312=/opt/homebrew/bin/python3.12
    else
      echo "  ERROR: python3.12 not found and Homebrew not installed."
      echo "  Install Python 3.12 first: https://www.python.org/downloads/"
      exit 1
    fi
  fi

  "$PY312" -m venv .venv-mlx
  source .venv-mlx/bin/activate
  pip install --upgrade pip
  # torch + torchvision are required: GlmOcrProcessor uses AutoImageProcessor
  # which falls back silently to a text-only tokenizer without them, producing empty OCR output.
  pip install "git+https://github.com/Blaizzy/mlx-vlm.git" torch torchvision
else
  source .venv-mlx/bin/activate
fi

echo "  Starting GLM-OCR on http://localhost:8080"
echo "  Model: mlx-community/GLM-OCR-bf16 (downloads on first run)"
echo "  Press Ctrl+C to stop."
echo ""

python -m mlx_vlm.server --trust-remote-code --port 8080
