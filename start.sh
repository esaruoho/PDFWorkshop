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

# Clear stale cache
rm -rf .next

# --- Platform detection ---
IS_APPLE_SILICON=false
if [[ "$(uname -m)" == "arm64" && "$(uname)" == "Darwin" ]]; then
  IS_APPLE_SILICON=true
fi

# --- Process tracking ---
NEXT_PID=""
MLX_PID=""
WATCHDOG_PID=""
MLX_LOG="/tmp/glm-ocr-mlx.log"

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

# ==========================================
# 1. Start Next.js FIRST
# ==========================================
echo ""
echo "Starting Next.js..."
npm run dev &
NEXT_PID=$!

# Wait for Next.js to be ready
TRIES=0
while [ $TRIES -lt 30 ]; do
  if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo "Next.js is ready at http://localhost:3000"
    break
  fi
  sleep 1
  TRIES=$((TRIES + 1))
done

# 2. Open browser now that Next.js is up
if command -v open &>/dev/null; then
  open http://localhost:3000
elif command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:3000
fi

# ==========================================
# 3. Start GLM-OCR MLX in background (Apple Silicon only)
# ==========================================
start_mlx() {
  # MLX auto-start disabled 2026-04-14: mlx-vlm 0.4.4's chat/completions sampler
  # does not honor repetition_penalty on GLM-OCR, producing 32k-char repetition
  # loops on prose pages. Ollama's llama.cpp sampler works correctly.
  # Set USE_MLX=1 to opt in manually once upstream fixes the sampler.
  if [ "${USE_MLX:-0}" != "1" ]; then return; fi
  if [ "$IS_APPLE_SILICON" != "true" ]; then return; fi

  # Set up MLX venv if not present
  if [ ! -d ".venv-mlx" ]; then
    echo ""
    echo "===== Setting up GLM-OCR MLX environment (first run only) ====="

    # Find Python 3.12 (prefer brew, fall back to PATH, else bootstrap via brew)
    local py312=""
    for cand in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12; do
      if command -v "$cand" >/dev/null 2>&1; then py312="$cand"; break; fi
    done
    if [ -z "$py312" ]; then
      if command -v brew >/dev/null 2>&1; then
        echo "Installing python@3.12 via Homebrew..."
        brew install python@3.12
        py312=/opt/homebrew/bin/python3.12
      else
        echo "ERROR: python3.12 not found. Install Homebrew or Python 3.12 first."
        return
      fi
    fi

    "$py312" -m venv .venv-mlx
    .venv-mlx/bin/pip install --upgrade pip -q
    echo "Installing mlx-vlm + torch (this takes a few minutes)..."
    # torch + torchvision are required: GlmOcrProcessor uses AutoImageProcessor
    # which falls back silently to a text-only tokenizer without them, producing empty OCR output.
    .venv-mlx/bin/pip install "git+https://github.com/Blaizzy/mlx-vlm.git" torch torchvision
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
      MLX_PID=""
      return
    fi
    sleep 1
    tries=$((tries + 1))
  done
  echo "WARNING: GLM-OCR server not ready after 5 minutes. Check $MLX_LOG"
}

# Auto-restart MLX on crash
mlx_watchdog() {
  if [ "$IS_APPLE_SILICON" != "true" ]; then return; fi
  while true; do
    sleep 5
    if [ -n "$MLX_PID" ] && ! kill -0 "$MLX_PID" 2>/dev/null; then
      echo ""
      echo "===== GLM-OCR server crashed — auto-restarting... ====="
      sleep 2
      .venv-mlx/bin/python -m mlx_vlm.server --trust-remote-code --port 8080 > "$MLX_LOG" 2>&1 &
      MLX_PID=$!
      local tries=0
      while [ $tries -lt 120 ]; do
        if curl -s http://localhost:8080/ >/dev/null 2>&1; then
          echo "===== GLM-OCR server restarted ====="
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

# ==========================================
# Status
# ==========================================
echo ""
echo "PDF Workshop — http://localhost:3000"
if [ "$IS_APPLE_SILICON" = "true" ]; then
  echo "GLM-OCR (local) — http://localhost:8080 (auto-restarts on crash)"
fi
echo "Press R to restart, Q to quit."
echo ""

# ==========================================
# Keyboard listener
# ==========================================
while true; do
  read -rsn1 key
  if [[ "$key" == "q" || "$key" == "Q" ]]; then
    echo ""
    echo "Quitting..."
    exit 0
  elif [[ "$key" == "r" || "$key" == "R" ]]; then
    echo ""
    echo "===== Restarting... ====="
    # Kill Next.js
    kill "$NEXT_PID" 2>/dev/null
    wait "$NEXT_PID" 2>/dev/null
    # Clear cache
    rm -rf .next
    # Restart MLX if needed
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
    # Restart Next.js
    npm run dev &
    NEXT_PID=$!
    echo "===== Restarted ====="
    echo ""
  fi
done
