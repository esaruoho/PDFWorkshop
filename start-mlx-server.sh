#!/bin/bash
set -e
cd "$(dirname "$0")"

echo ""
echo "  GLM-OCR MLX Server (Apple Silicon)"
echo "  ==================================="
echo ""

if [ ! -d ".venv-mlx" ]; then
  echo "  Setting up MLX environment (first run only)..."
  python3.12 -m venv .venv-mlx
  source .venv-mlx/bin/activate
  pip install --upgrade pip
  pip install "git+https://github.com/Blaizzy/mlx-vlm.git"
else
  source .venv-mlx/bin/activate
fi

echo "  Starting GLM-OCR on http://localhost:8080"
echo "  Model: mlx-community/GLM-OCR-bf16 (downloads on first run)"
echo "  Press Ctrl+C to stop."
echo ""

python -m mlx_vlm.server --trust-remote-code --port 8080
