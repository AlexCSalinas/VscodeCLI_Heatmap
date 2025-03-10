#!/bin/bash
# Quick build script that bypasses tests

# Compile only the extension.ts file
echo "Compiling only the extension files..."
mkdir -p out
npx tsc --skipLibCheck src/extension.ts --outDir out

# Package the extension
echo "Packaging the extension..."
npx vsce package

echo "Done! Look for the .vsix file in the current directory."