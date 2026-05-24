#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# ANSI escape codes for colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== HSS-CE Installer ===${NC}"
echo "Setting up Hybrid Semantic-Structural Context Engine..."

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please download and install Node.js (version 18 or higher) from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "Node.js detected: ${GREEN}${NODE_VERSION}${NC}"

# 2. Check Git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: Git is not installed.${NC}"
    echo "Please install Git or make sure it is in your PATH."
    exit 1
fi
echo -e "Git detected: ${GREEN}$(git --version)${NC}"

# 3. Install Dependencies
echo "Installing npm dependencies..."
npm install

# 4. Verify CLI Tool
echo "Verifying HSS-CE installation..."
node src/cli.js > /dev/null || true

echo -e "${GREEN}=== Installation Successful! ===${NC}"
echo ""
echo "Launching HSS-CE integration wizard..."
node src/integrate.js
