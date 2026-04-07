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

# --- Start GLM-OCR MLX server (Apple Silicon only) ---
MLX_PID=""
MLX_LOG="/tmp/glm-ocr-mlx.log"

if [[ "$(uname -m)" == "arm64" && "$(uname)" == "Darwin" ]]; then
  # Set up MLX venv if not present
  if [ ! -d ".venv-mlx" ]; then
    echo ""
    echo "===== Setting up GLM-OCR MLX environment (first run only) ====="
    python3.12 -m venv .venv-mlx
    .venv-mlx/bin/pip install --upgrade pip -q
    echo "Installing mlx-vlm (this takes a few minutes)..."
    .venv-mlx/bin/pip install "git+https://github.com/Blaizzy/mlx-vlm.git"
    echo "===== GLM-OCR MLX environment ready ====="
    echo ""
  fi

  # Check if MLX server is already running on port 8080
  if ! curl -s http://localhost:8080/ >/dev/null 2>&1; then
    echo ""
    echo "===== Starting GLM-OCR MLX server ====="
    echo "  Port: http://localhost:8080"
    echo "  Log:  $MLX_LOG"
    echo ""
    echo "  First run downloads the model (~1.8 GB) — watch progress below."
    echo "  After download, model loads into memory (~30s)."
    echo "  Once you see 'Uvicorn running', the server is ready."
    echo ""

    # Run MLX server — output visible in terminal AND saved to log
    .venv-mlx/bin/python -m mlx_vlm.server --trust-remote-code --port 8080 2>&1 | tee "$MLX_LOG" &
    MLX_PID=$!

    # Wait until the server actually responds (model downloaded + loaded)
    echo "  Waiting for GLM-OCR server to be ready..."
    TRIES=0
    MAX_TRIES=300  # 5 minutes max (first download can be slow)
    while [ $TRIES -lt $MAX_TRIES ]; do
      if curl -s http://localhost:8080/ >/dev/null 2>&1; then
        echo ""
        echo "===== GLM-OCR server is ready! ====="
        echo ""
        break
      fi
      # Check if process died
      if ! kill -0 "$MLX_PID" 2>/dev/null; then
        echo ""
        echo "ERROR: GLM-OCR server failed to start. Check $MLX_LOG"
        echo ""
        break
      fi
      sleep 1
      TRIES=$((TRIES + 1))
    done

    if [ $TRIES -eq $MAX_TRIES ]; then
      echo ""
      echo "WARNING: GLM-OCR server not ready after 5 minutes."
      echo "It may still be downloading. Check $MLX_LOG"
      echo "PDF Workshop will start anyway — GLM-OCR will work once the server is ready."
      echo ""
    fi
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

# Open browser
if command -v open &>/dev/null; then
  (sleep 2 && open http://localhost:3000) &
elif command -v xdg-open &>/dev/null; then
  (sleep 2 && xdg-open http://localhost:3000) &
fi

echo ""
echo "PDF Workshop — http://localhost:3000"
echo "GLM-OCR (local) — http://localhost:8080"
echo "Press R to restart, Ctrl+C to stop."
echo ""

# Run Next.js dev server in background so we can listen for keypress
start_next() {
  npm run dev &
  NEXT_PID=$!
}

# Update cleanup to also kill Next.js
cleanup() {
  if [ -n "$NEXT_PID" ]; then
    kill "$NEXT_PID" 2>/dev/null
    wait "$NEXT_PID" 2>/dev/null
  fi
  if [ -n "$MLX_PID" ]; then
    echo ""
    echo "Stopping GLM-OCR MLX server..."
    kill "$MLX_PID" 2>/dev/null
    wait "$MLX_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

start_next

# Listen for 'r' or 'R' keypress to restart Next.js
while true; do
  read -rsn1 key
  if [[ "$key" == "r" || "$key" == "R" ]]; then
    echo ""
    echo "===== Restarting Next.js dev server ====="
    kill "$NEXT_PID" 2>/dev/null
    wait "$NEXT_PID" 2>/dev/null
    start_next
    echo "===== Restarted ====="
    echo ""
  fi
done
