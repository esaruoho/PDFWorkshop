#!/bin/bash
set -e

cd "$(dirname "$0")"

# Use bundled Node.js if available
if [ -d "node/bin" ]; then
  export PATH="$(pwd)/node/bin:$PATH"
  echo "Using bundled Node.js"
elif ! command -v node &>/dev/null; then
  echo ""
  echo "Node.js not found. Downloading portable Node.js..."
  echo ""
  if [[ "$(uname)" == "Darwin" ]]; then
    ARCH=$(uname -m)
    if [[ "$ARCH" == "arm64" ]]; then
      NODE_URL="https://nodejs.org/dist/v20.19.0/node-v20.19.0-darwin-arm64.tar.gz"
    else
      NODE_URL="https://nodejs.org/dist/v20.19.0/node-v20.19.0-darwin-x64.tar.gz"
    fi
  else
    NODE_URL="https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-x64.tar.gz"
  fi
  curl -L "$NODE_URL" -o node-download.tar.gz
  mkdir -p node
  tar xzf node-download.tar.gz -C node --strip-components=1
  rm node-download.tar.gz
  export PATH="$(pwd)/node/bin:$PATH"
  echo "Node.js installed locally."
  echo ""
fi

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

# --- Start GLM-OCR MLX server in background (Apple Silicon only) ---
MLX_PID=""
if [[ "$(uname -m)" == "arm64" && "$(uname)" == "Darwin" ]]; then
  # Set up MLX venv if not present
  if [ ! -d ".venv-mlx" ]; then
    echo ""
    echo "Setting up GLM-OCR MLX environment (first run only)..."
    python3.12 -m venv .venv-mlx
    .venv-mlx/bin/pip install --upgrade pip -q
    .venv-mlx/bin/pip install "git+https://github.com/Blaizzy/mlx-vlm.git" -q
    echo "GLM-OCR MLX environment ready."
  fi

  # Check if MLX server is already running on port 8080
  if ! curl -s http://localhost:8080/ >/dev/null 2>&1; then
    echo ""
    echo "Starting GLM-OCR MLX server on http://localhost:8080 ..."
    echo "(Model downloads on first run — this may take a few minutes)"
    .venv-mlx/bin/python -m mlx_vlm.server --trust-remote-code --port 8080 &
    MLX_PID=$!
    echo "GLM-OCR MLX server started (PID $MLX_PID)"
  else
    echo "GLM-OCR MLX server already running on :8080"
  fi
fi

# Clean up MLX server on exit
cleanup() {
  if [ -n "$MLX_PID" ]; then
    echo ""
    echo "Stopping GLM-OCR MLX server..."
    kill "$MLX_PID" 2>/dev/null
    wait "$MLX_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

# Open browser after a short delay
if command -v open &>/dev/null; then
  (sleep 2 && open http://localhost:3000) &
elif command -v xdg-open &>/dev/null; then
  (sleep 2 && xdg-open http://localhost:3000) &
fi

echo ""
echo "PDF Workshop — http://localhost:3000"
echo "GLM-OCR (local) — http://localhost:8080"
echo "Press Ctrl+C to stop."
echo ""
npm run dev
