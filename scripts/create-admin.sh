#!/bin/bash

# ParkTayo Admin Account Creation Script (Unix/Linux/macOS)
# This shell script runs the create-admin.js script

set -e  # Exit on any error

echo ""
echo "================================================"
echo "ParkTayo Admin Account Creation Script"
echo "================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ ERROR: Node.js is not installed or not in PATH"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# Change to the backend directory
cd "$BACKEND_DIR"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: package.json not found"
    echo "Make sure you're running this from the parktayo-backend directory"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run the admin creation script
echo "🔧 Running admin creation script..."
echo ""
node scripts/create-admin.js "$@"

echo ""
echo "✅ Script completed."
