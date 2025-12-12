#!/bin/bash

# Etsy MCP Server - GitHub Deployment Script
# Repository: https://github.com/administrativetrick/etsy-mcp-server

set -e  # Exit on error

echo "🚀 Deploying Etsy MCP Server to GitHub..."
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the project root."
    exit 1
fi

# Initialize git if not already done
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    echo "✅ Git initialized"
else
    echo "✅ Git already initialized"
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo ""
    echo "📝 Adding all files..."
    git add .
    
    echo ""
    echo "💾 Creating commit..."
    git commit -m "Initial commit: Etsy MCP Server v1.0.0"
    echo "✅ Commit created"
else
    echo "✅ No changes to commit"
fi

# Add remote if not already added
if ! git remote | grep -q "origin"; then
    echo ""
    echo "🔗 Adding GitHub remote..."
    git remote add origin https://github.com/administrativetrick/etsy-mcp-server.git
    echo "✅ Remote added"
else
    echo "✅ Remote already configured"
fi

# Rename branch to main if needed
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo ""
    echo "🔄 Renaming branch to main..."
    git branch -M main
    echo "✅ Branch renamed"
fi

# Push to GitHub
echo ""
echo "⬆️  Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Successfully pushed to GitHub!"
echo ""
echo "🌐 Repository: https://github.com/administrativetrick/etsy-mcp-server"
echo ""
echo "📋 Next steps:"
echo "1. Visit your repository on GitHub"
echo "2. Add topics: mcp, etsy, api, claude, typescript"
echo "3. Set up npm publishing (see SETUP.md for details)"
echo "4. Create a release with: git tag v1.0.0 && git push origin v1.0.0"
echo ""
