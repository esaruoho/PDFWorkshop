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

# Open browser after a short delay
if command -v open &>/dev/null; then
  (sleep 2 && open http://localhost:3000) &
elif command -v xdg-open &>/dev/null; then
  (sleep 2 && xdg-open http://localhost:3000) &
fi

echo ""
echo "PDF Workshop — http://localhost:3000"
echo "Press Ctrl+C to stop."
echo ""
npm run dev
