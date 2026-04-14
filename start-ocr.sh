#!/usr/bin/env bash
# start-ocr.sh — Bootstrap the OCR worker daemon with caffeinate.
#
# Designed for CloudcityMacMini — prevents sleep, auto-restarts on crash,
# and ensures GLM-OCR backend is available.
#
# Usage:
#   ./start-ocr.sh              # Normal start
#   ./start-ocr.sh --once       # Process queue and exit
#
# Add to Cloudcity-Boot.app or run in a dedicated iTerm pane.

set -euo pipefail

cd "$(dirname "$0")"

# Set up Homebrew environment (macOS Apple Silicon)
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Source .env if present (API keys, custom config)
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

echo "╔═══════════════════════════════════════════════╗"
echo "║  PDFWorkshop — OCR Worker Daemon              ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
echo "Repo:    $(pwd)"
echo "Started: $(date)"
echo "Host:    $(hostname -s)"
echo ""

# Ensure queue directories exist
mkdir -p queue/{pending,processing,done,failed,uploads}

# Ensure Syncthing results directory exists
mkdir -p "${HOME}/work/comms/queue/ocr-results"

# Ensure npm deps are installed
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install --production 2>&1 | tail -5
  echo ""
fi

# --- GLM-OCR backend detection + auto-bootstrap ---
check_backend() {
  if curl -sf --max-time 3 "http://localhost:8080/v1/models" >/dev/null 2>&1; then
    echo "MLX (:8080)"; return 0
  fi
  if curl -sf --max-time 3 "http://localhost:11434/api/tags" 2>/dev/null | grep -q "glm-ocr"; then
    echo "Ollama (:11434)"; return 0
  fi
  echo "NONE"; return 1
}

# On Apple Silicon, auto-start MLX server if not already running.
# MLX with GLM-OCR is ~2× faster than Ollama and uses the Neural Engine.
is_apple_silicon() {
  [[ "$(uname -m)" == "arm64" && "$(uname)" == "Darwin" ]]
}

bootstrap_mlx_venv() {
  if [[ -d .venv-mlx ]]; then return 0; fi

  echo "Bootstrapping MLX venv (first run)..."
  local py312=""
  for cand in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12; do
    if command -v "$cand" >/dev/null 2>&1; then py312="$cand"; break; fi
  done
  if [[ -z "$py312" ]]; then
    if command -v brew >/dev/null 2>&1; then
      echo "  Installing python@3.12 via Homebrew..."
      brew install python@3.12
      py312=/opt/homebrew/bin/python3.12
    else
      echo "  ERROR: python3.12 + Homebrew missing; cannot bootstrap MLX."
      return 1
    fi
  fi

  "$py312" -m venv .venv-mlx
  .venv-mlx/bin/pip install --upgrade pip -q
  echo "  Installing mlx-vlm + torch (few minutes)..."
  # torch + torchvision required — GlmOcrProcessor uses AutoImageProcessor
  # which silently returns a text-only tokenizer without them (empty OCR output).
  .venv-mlx/bin/pip install "git+https://github.com/Blaizzy/mlx-vlm.git" torch torchvision -q
  echo "  MLX venv ready."
}

start_mlx_server() {
  local log=/tmp/pdfworkshop-mlx.log
  nohup .venv-mlx/bin/python -m mlx_vlm.server \
    --trust-remote-code --port 8080 > "$log" 2>&1 &
  disown
  echo "MLX server launched (log: $log). Waiting for readiness..."
  local tries=0
  while (( tries < 60 )); do
    if curl -sf --max-time 2 http://localhost:8080/v1/models >/dev/null 2>&1; then
      echo "MLX server ready on :8080"
      return 0
    fi
    sleep 1
    tries=$((tries + 1))
  done
  echo "WARNING: MLX server did not come up within 60s (check $log)"
  return 1
}

backend="$(check_backend || true)"

# NOTE: MLX auto-start was removed 2026-04-14 after discovering that mlx-vlm
# 0.4.4's chat/completions sampler does not honor repetition_penalty on GLM-OCR,
# causing catastrophic repetition loops on prose pages (32k-char garbage output).
# The bootstrap_mlx_venv and start_mlx_server functions above remain for manual
# use once upstream fixes the sampler bug (Blaizzy/mlx-vlm). Ollama's llama.cpp
# sampler works correctly and is the recommended backend.

echo "OCR Backend: ${backend}"

if [[ "$backend" == "NONE" ]]; then
  echo ""
  echo "WARNING: No GLM-OCR backend detected."
  echo "  Ollama (recommended): ollama pull glm-ocr:latest && ollama serve"
  echo "  MLX (experimental, has known repetition bug): ./start-mlx-server.sh"
  echo ""
  echo "Worker will start but jobs will fail until a backend is available."
fi

echo ""

# --- Crash-resilient restart loop with caffeinate ---
MAX_BACKOFF=60
BACKOFF=5

while true; do
  echo "[$(date +%H:%M:%S)] Starting ocr-worker (caffeinate -s)..."

  # caffeinate -s: prevent system sleep while process runs
  # caffeinate -w: release when child exits
  if caffeinate -s -w $$ -- ./ocr-worker "$@"; then
    echo "[$(date +%H:%M:%S)] Worker exited cleanly."
    break
  fi

  EXIT_CODE=$?

  # Exit code 75 = user-requested restart (from signal)
  if [[ $EXIT_CODE -eq 75 ]]; then
    echo "[$(date +%H:%M:%S)] Restart requested."
    BACKOFF=5
    continue
  fi

  echo "[$(date +%H:%M:%S)] Worker crashed (exit ${EXIT_CODE}). Restarting in ${BACKOFF}s..."
  sleep "$BACKOFF"

  # Exponential backoff
  BACKOFF=$((BACKOFF * 2))
  if [[ $BACKOFF -gt $MAX_BACKOFF ]]; then
    BACKOFF=$MAX_BACKOFF
  fi
done
