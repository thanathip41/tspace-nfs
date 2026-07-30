#!/bin/bash

set -e

# Check package.json
if [ ! -f package.json ]; then
  echo "package.json not found"
  exit 1
fi

# Read version
VERSION=$(node -p "require('./package.json').version")

if [ -z "$VERSION" ]; then
  echo "Version not found in package.json"
  exit 1
fi

echo "Checking release version: $VERSION"

# Fetch latest tags
git fetch --tags

# Check local tag
if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Local tag '$VERSION' already exists"
  exit 1
fi

# Check remote tag
if git ls-remote --tags origin | grep -q "refs/tags/$VERSION$"; then
  echo "Remote tag '$VERSION' already exists"
  exit 1
fi

echo "Running tests..."
npm test

echo "Building project..."
npm run build

echo "Publishing package..."
npm publish

echo "Creating git tag..."
git tag -a "$VERSION" -m "release: $VERSION"

echo "Pushing git tag..."
git push origin "$VERSION"

echo "Release completed successfully"