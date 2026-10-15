# Contributing

## Development requirements

- Node.js 22 or later (CI tests Node.js 22 and 24).
- npm.
- No Etsy credentials are needed for local tests.

## Build and test

```bash
npm ci --ignore-scripts
npm run build
npm test
npm audit --omit=dev --audit-level=high
```

Tests use Node.js's built-in test runner and mocked HTTP responses. They do not make live Etsy requests.

## Project shape

- `src/` contains the TypeScript implementation.
- `test/` contains focused behavioral tests.
- `build/` is generated JavaScript and is not committed.
- `.github/workflows/ci.yml` builds and checks changes on Node.js 22 and 24.

Keep this project a small stdio MCP server. New Etsy tools must use documented read-only API-key endpoints, validate their inputs at runtime, bound returned data, and preserve the distinction between untrusted Etsy text and server-generated messages. Do not add filesystem or shell tools, arbitrary URL fetching, OAuth, write operations, or a network-facing MCP transport without a separately reviewed need.

Update `CHANGELOG.md` for user-visible behavior changes. Tool removals or incompatible tool-schema changes require a major version change. CI does not publish packages.
