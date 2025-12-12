# Quick Start Checklist

Copy this checklist and check off items as you complete them.

## Pre-Publishing

- [ ] Review all code in `src/index.ts`
- [ ] Test locally with `npm run build && npm run dev`
- [ ] Get an Etsy API key from https://www.etsy.com/developers
- [ ] Test each tool with real API calls
- [ ] Review README.md and update if needed

## GitHub Setup

- [ ] Create GitHub account (if you don't have one)
- [ ] Create new repository named `etsy-mcp-server` (public)
- [ ] Update `package.json` - replace `YOUR_USERNAME` with your GitHub username
- [ ] Run: `git init`
- [ ] Run: `git add .`
- [ ] Run: `git commit -m "Initial commit: Etsy MCP Server v1.0.0"`
- [ ] Run: `git remote add origin https://github.com/YOUR_USERNAME/etsy-mcp-server.git`
- [ ] Run: `git branch -M main`
- [ ] Run: `git push -u origin main`
- [ ] Add repository topics on GitHub: `mcp`, `etsy`, `api`, `claude`, `typescript`

## npm Publishing Setup

- [ ] Create npm account at https://www.npmjs.com/signup
- [ ] Verify email address
- [ ] Run: `npm login` (from command line)
- [ ] Generate npm Automation token at https://www.npmjs.com/settings/YOUR_USERNAME/tokens
- [ ] Add `NPM_TOKEN` to GitHub Secrets (Settings → Secrets and variables → Actions)

## First Release

### Option A: Manual (Quick)
- [ ] Run: `npm run build`
- [ ] Run: `npm publish`

### Option B: Automated (Recommended)
- [ ] Run: `git tag v1.0.0`
- [ ] Run: `git push origin v1.0.0`
- [ ] Wait for GitHub Actions to complete
- [ ] Check Actions tab on GitHub for build status

## Verification

- [ ] Visit https://www.npmjs.com/package/etsy-mcp-server
- [ ] Test global install: `npm install -g etsy-mcp-server`
- [ ] Configure in Claude Desktop (see README.md)
- [ ] Test a query: "Search Etsy for handmade mugs"

## Post-Launch (Optional)

- [ ] Share on Twitter/X
- [ ] Share on LinkedIn
- [ ] Post in MCP Discord/Community
- [ ] Add to awesome-mcp lists
- [ ] Write a blog post about building it
- [ ] Create demo video

## Common Issues

**"Repository not found"**
→ Double-check GitHub username in package.json and remote URL

**"Package name already taken"**
→ Choose a different name in package.json (e.g., `@your-username/etsy-mcp-server`)

**"Authentication failed"**
→ Run `npm login` and verify your credentials

**"GitHub Actions failing"**
→ Check that NPM_TOKEN secret is set correctly in GitHub

**"Permission denied"**
→ Verify you have write access to the repository

## Need Help?

- GitHub Issues: Use for bugs and feature requests
- MCP Documentation: https://modelcontextprotocol.io/
- Etsy API Docs: https://developers.etsy.com/documentation/
- npm Publishing: https://docs.npmjs.com/

---

**Estimated Time:** 30-45 minutes for first-time setup
