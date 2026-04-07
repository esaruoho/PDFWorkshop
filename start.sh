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

# --- MLX server management (Apple Silicon only) ---
MLX_PID=""
MLX_LOG="/tmp/glm-ocr-mlx.log"
IS_APPLE_SILICON=false
if [[ "$(uname -m)" == "arm64" && "$(uname)" == "Darwin" ]]; then
  IS_APPLE_SILICON=true
fi

start_mlx() {
  if [ "$IS_APPLE_SILICON" != "true" ]; then return; fi

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

  # Check if already running
  if curl -s http://localhost:8080/ >/dev/null 2>&1; then
    echo "GLM-OCR MLX server already running on :8080"
    return
  fi

  echo ""
  echo "===== Starting GLM-OCR MLX server ====="
  echo "  Port: http://localhost:8080"
  echo "  Log:  $MLX_LOG"
  echo ""

  .venv-mlx/bin/python -m mlx_vlm.server --trust-remote-code --port 8080 > "$MLX_LOG" 2>&1 &
  MLX_PID=$!

  echo "  Waiting for GLM-OCR server..."
  local tries=0
  while [ $tries -lt 300 ]; do
    if curl -s http://localhost:8080/ >/dev/null 2>&1; then
      echo "===== GLM-OCR server is ready! ====="
      echo ""
      return
    fi
    if ! kill -0 "$MLX_PID" 2>/dev/null; then
      echo "ERROR: GLM-OCR server failed to start. Check $MLX_LOG"
      echo ""
      MLX_PID=""
      return
    fi
    sleep 1
    tries=$((tries + 1))
  done
  echo "WARNING: GLM-OCR server not ready after 5 minutes. Check $MLX_LOG"
  echo ""
}

# Auto-restart MLX if it crashes (runs in background)
mlx_watchdog() {
  if [ "$IS_APPLE_SILICON" != "true" ]; then return; fi
  while true; do
    sleep 5
    # If we had a PID and it died, restart
    if [ -n "$MLX_PID" ] && ! kill -0 "$MLX_PID" 2>/dev/null; then
      echo ""
      echo "===== GLM-OCR server crashed — auto-restarting... ====="
      echo ""
      sleep 2
      .venv-mlx/bin/python -m mlx_vlm.server --trust-remote-code --port 8080 > "$MLX_LOG" 2>&1 &
      MLX_PID=$!
      # Wait for it to come back
      local tries=0
      while [ $tries -lt 120 ]; do
        if curl -s http://localhost:8080/ >/dev/null 2>&1; then
          echo "===== GLM-OCR server restarted successfully ====="
          echo ""
          break
        fi
        if ! kill -0 "$MLX_PID" 2>/dev/null; then
          echo "ERROR: GLM-OCR restart failed. Check $MLX_LOG"
          MLX_PID=""
          break
        fi
        sleep 1
        tries=$((tries + 1))
      done
    fi
  done
}

start_mlx
mlx_watchdog &
WATCHDOG_PID=$!

# --- Next.js ---
NEXT_PID=""
start_next() {
  npm run dev &
  NEXT_PID=$!
}

# Cleanup on exit
cleanup() {
  [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null
  [ -n "$NEXT_PID" ] && kill "$NEXT_PID" 2>/dev/null && wait "$NEXT_PID" 2>/dev/null
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
if [ "$IS_APPLE_SILICON" = "true" ]; then
  echo "GLM-OCR (local) — http://localhost:8080 (auto-restarts on crash)"
fi
echo "Press R to restart servers, Ctrl+C to stop."
echo ""

start_next

# Listen for 'r' or 'R' to restart everything
while true; do
  read -rsn1 key
  if [[ "$key" == "r" || "$key" == "R" ]]; then
    echo ""
    echo "===== Restarting... ====="
    # Restart Next.js
    kill "$NEXT_PID" 2>/dev/null
    wait "$NEXT_PID" 2>/dev/null
    # Restart MLX if on Apple Silicon
    if [ "$IS_APPLE_SILICON" = "true" ] && [ -n "$MLX_PID" ]; then
      kill "$MLX_PID" 2>/dev/null
      wait "$MLX_PID" 2>/dev/null
      sleep 1
      .venv-mlx/bin/python -m mlx_vlm.server --trust-remote-code --port 8080 > "$MLX_LOG" 2>&1 &
      MLX_PID=$!
      echo "  MLX server restarting..."
      local_tries=0
      while [ $local_tries -lt 60 ]; do
        if curl -s http://localhost:8080/ >/dev/null 2>&1; then
          echo "  MLX server ready"
          break
        fi
        sleep 1
        local_tries=$((local_tries + 1))
      done
    fi
    start_next
    echo "===== Restarted ====="
    echo ""
  fi
done
