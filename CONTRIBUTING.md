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

Keep this project a focused Etsy stdio MCP server. The supported development scope includes documented public reads, OAuth-authorized account access, inventory, and create/update/delete operations. Read-only access is the current implementation baseline, not a restriction on future features. See [access and operation policy](docs/access-policy.md) and the [feature roadmap](docs/roadmap.md).

New tools must validate inputs at runtime, bound returned data, sanitize errors, and distinguish untrusted Etsy text from server-generated messages. OAuth features must use least-privilege scopes, protect tokens, and verify the authorized account/resource boundary. Write tools must require operation-specific user authorization, present consequential changes for confirmation, and handle uncertain outcomes without blindly repeating mutations. Mark tool safety annotations accurately; annotations alone are not authorization controls.

Keep API requests on explicitly approved Etsy origins with TLS verification, redirect blocking, and credential isolation. OAuth authorization/token endpoints may be explicitly allowlisted as part of OAuth support; this does not permit arbitrary URL fetching. Do not add generic filesystem or shell tools or a network-facing MCP transport. Any HTTPS callback component needed for OAuth or webhook delivery must be separately bounded and reviewed; it is not a public MCP endpoint.

Update `CHANGELOG.md` for user-visible behavior changes. Tool removals or incompatible tool-schema changes require a major version change. CI does not publish packages.
