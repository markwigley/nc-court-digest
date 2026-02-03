#!/usr/bin/env bash
# Build script for Render deployment

set -e

echo "Installing npm dependencies..."
npm install

echo "Installing Playwright with system dependencies..."
npx playwright install chromium --with-deps

echo "Build complete!"
