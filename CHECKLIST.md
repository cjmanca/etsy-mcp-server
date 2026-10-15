# Review checklist

Before submitting a change:

- [ ] Confirm every Etsy endpoint and parameter against the current official API reference.
- [ ] Keep Etsy access read-only and on the fixed Etsy API origin.
- [ ] Validate tool arguments before making requests.
- [ ] Keep errors sanitized and responses bounded.
- [ ] Preserve the notice that Etsy text is untrusted external data.
- [ ] Update the changelog and README for user-visible changes.
- [ ] Run `npm ci --ignore-scripts`, `npm run build`, `npm test`, and `npm audit --omit=dev --audit-level=high`.
- [ ] Confirm CI remains limited to build, test, and audit jobs; it must not publish packages.
