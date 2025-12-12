# GitHub Repository Setup Guide

This guide walks you through publishing the Etsy MCP Server to GitHub and npm.

## Prerequisites

- GitHub account
- npm account (create at [npmjs.com](https://www.npmjs.com/signup))
- Git installed locally
- Node.js 18+ installed

## Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `etsy-mcp-server`
3. Description: "MCP server for Etsy API integration"
4. **Keep it Public** (required for npm publishing)
5. **Do NOT initialize** with README, .gitignore, or license (we already have these)
6. Click "Create repository"

## Step 2: Update Repository URLs

After creating the GitHub repo, update `package.json`:

Replace `YOUR_USERNAME` with your actual GitHub username in these lines:
```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/YOUR_USERNAME/etsy-mcp-server.git"
},
"bugs": {
  "url": "https://github.com/YOUR_USERNAME/etsy-mcp-server/issues"
},
"homepage": "https://github.com/YOUR_USERNAME/etsy-mcp-server#readme",
```

## Step 3: Initialize Git and Push

```bash
cd /path/to/etsy-mcp-server

# Initialize git repository
git init

# Add all files
git add .

# Make initial commit
git commit -m "Initial commit: Etsy MCP Server v1.0.0"

# Add your GitHub repository as remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/etsy-mcp-server.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 4: Set Up npm Publishing

### Option A: Manual Publishing (Simple)

1. Login to npm:
   ```bash
   npm login
   ```

2. Build and publish:
   ```bash
   npm run build
   npm publish
   ```

### Option B: Automated Publishing via GitHub Actions (Recommended)

This is already configured in `.github/workflows/ci.yml`

1. **Create npm Access Token:**
   - Go to [npmjs.com/settings/YOUR_USERNAME/tokens](https://www.npmjs.com/settings/)
   - Click "Generate New Token" → "Classic Token"
   - Select "Automation" type
   - Copy the token (starts with `npm_...`)

2. **Add Token to GitHub Secrets:**
   - Go to your GitHub repo → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your npm token
   - Click "Add secret"

3. **Publish with Git Tag:**
   ```bash
   # Create and push a version tag
   git tag v1.0.0
   git push origin v1.0.0
   ```
   
   GitHub Actions will automatically build and publish to npm!

## Step 5: Verify Publication

1. Check npm: [npmjs.com/package/etsy-mcp-server](https://www.npmjs.com/package/etsy-mcp-server)
2. Test installation:
   ```bash
   npm install -g etsy-mcp-server
   ```

## Step 6: Update README Installation Instructions

Once published to npm, users can install with:
```bash
npm install -g etsy-mcp-server
```

And configure Claude Desktop:
```json
{
  "mcpServers": {
    "etsy": {
      "command": "npx",
      "args": ["-y", "etsy-mcp-server"],
      "env": {
        "ETSY_API_KEY": "your_api_key"
      }
    }
  }
}
```

## Future Updates

### Making Changes

1. Make your code changes
2. Update `CHANGELOG.md`
3. Update version in `package.json` (follow [semver](https://semver.org/)):
   - Patch (1.0.x): Bug fixes
   - Minor (1.x.0): New features, backwards compatible
   - Major (x.0.0): Breaking changes

4. Commit and tag:
   ```bash
   git add .
   git commit -m "Description of changes"
   git tag v1.0.1  # Use appropriate version
   git push origin main
   git push origin v1.0.1
   ```

5. GitHub Actions will automatically publish the new version!

## Maintenance Checklist

- [ ] Create GitHub repository
- [ ] Update package.json with your GitHub username
- [ ] Initialize git and push code
- [ ] Create npm account (if needed)
- [ ] Set up NPM_TOKEN secret in GitHub
- [ ] Tag and push v1.0.0 to trigger automated publishing
- [ ] Verify package appears on npm
- [ ] Test installation globally
- [ ] Update README if needed
- [ ] Announce on social media / relevant communities

## Troubleshooting

### "Repository not found"
- Double-check your GitHub username in the remote URL
- Make sure the repository exists on GitHub

### "npm publish failed"
- Verify you're logged in: `npm whoami`
- Check if package name is available: `npm search etsy-mcp-server`
- Ensure you have publish permissions

### "GitHub Actions failing"
- Check that NPM_TOKEN secret is set correctly
- Verify the token has Automation permissions
- Check Actions logs for specific errors

## Tips

- **Add Topics**: On GitHub, add topics like `mcp`, `etsy`, `api`, `claude`, `ai-tools`
- **Add Description**: Fill in the repository description on GitHub
- **Pin Repository**: Pin it to your profile if it's a key project
- **Add Shields**: Consider adding badges to README (build status, npm version, license)
- **Star Repos**: Star the MCP SDK repo and related projects

## Resources

- [npm Publishing Guide](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
