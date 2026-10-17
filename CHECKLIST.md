# Review checklist

Before submitting a change:

- [ ] Confirm every Etsy endpoint and parameter against the current official API reference.
- [ ] Keep Etsy API requests on approved, fixed Etsy origins; isolate any explicitly approved OAuth authorization/token endpoints.
- [ ] For OAuth/private reads, enforce least-privilege scopes, account/resource authorization, token protection, and sensitive-field minimization.
- [ ] For writes, require operation-specific user authorization and consequential-change confirmation; verify outcomes without blindly retrying mutations.
- [ ] Set accurate read-only/destructive/idempotency annotations for new tools; enforce safety in the server rather than trusting annotations alone.
- [ ] Validate tool arguments before making requests.
- [ ] Keep errors sanitized and responses bounded.
- [ ] For inventory replacements, refuse to derive a write from a truncated snapshot and preserve unrelated variants.
- [ ] Preserve the notice that Etsy text is untrusted external data.
- [ ] Update the changelog and README for user-visible changes.
- [ ] Keep implemented-feature documentation separate from proposed tools and update the API coverage matrix and TODO list when features ship.
- [ ] Run `npm ci --ignore-scripts`, `npm run build`, `npm test`, and `npm audit --omit=dev --audit-level=high`.
- [ ] Confirm CI remains limited to build, test, and audit jobs; it must not publish packages.
