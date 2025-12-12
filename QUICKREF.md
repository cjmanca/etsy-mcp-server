# Quick Reference - administrativetrick/etsy-mcp-server

## 🚀 Push to GitHub (First Time)

### Option A: Use the deploy script
```bash
cd /path/to/etsy-mcp-server
./deploy.sh
```

### Option B: Manual commands
```bash
cd /path/to/etsy-mcp-server

# Initialize and commit
git init
git add .
git commit -m "Initial commit: Etsy MCP Server v1.0.0"

# Add remote and push
git remote add origin https://github.com/administrativetrick/etsy-mcp-server.git
git branch -M main
git push -u origin main
```

## 📦 Publish to npm

### First time setup
```bash
# Login to npm
npm login

# Install dependencies and build
npm install
npm run build
```

### Option A: Manual publish
```bash
npm publish
```

### Option B: Automated via GitHub Actions

1. **Get npm token:**
   - Go to: https://www.npmjs.com/settings/administrativetrick/tokens
   - Click "Generate New Token" → "Automation"
   - Copy the token

2. **Add to GitHub:**
   - Go to: https://github.com/administrativetrick/etsy-mcp-server/settings/secrets/actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: [paste your token]

3. **Publish with tag:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions will automatically publish!

## 🔄 Making Updates

```bash
# Make your changes, then:
git add .
git commit -m "Description of changes"
git push origin main

# For releases:
# Update version in package.json first!
git tag v1.0.1
git push origin v1.0.1
```

## 🧪 Test Locally

```bash
# Build
npm run build

# Test the build
node build/index.js

# Or run in dev mode
npm run dev
```

## 📥 Install Your Published Package

```bash
# Global install
npm install -g etsy-mcp-server

# Test it works
which etsy-mcp-server
```

## 🔗 Important Links

- **Repository:** https://github.com/administrativetrick/etsy-mcp-server
- **npm page:** https://www.npmjs.com/package/etsy-mcp-server (after publishing)
- **Issues:** https://github.com/administrativetrick/etsy-mcp-server/issues
- **Actions:** https://github.com/administrativetrick/etsy-mcp-server/actions

## ⚙️ Claude Desktop Config

After publishing to npm, users configure it like this:

```json
{
  "mcpServers": {
    "etsy": {
      "command": "npx",
      "args": ["-y", "etsy-mcp-server"],
      "env": {
        "ETSY_API_KEY": "your_etsy_api_key_here"
      }
    }
  }
}
```

Config file locations:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

## 🆘 Troubleshooting

**"remote origin already exists"**
```bash
git remote remove origin
git remote add origin https://github.com/administrativetrick/etsy-mcp-server.git
```

**"fatal: not a git repository"**
```bash
git init
```

**npm publish fails with "package already exists"**
- Package name might be taken
- Try: `@administrativetrick/etsy-mcp-server` in package.json
