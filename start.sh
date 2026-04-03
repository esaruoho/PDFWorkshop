#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# Open browser after a short delay
(sleep 2 && open http://localhost:3000) &

echo "Starting PDF Workshop..."
npm run dev
