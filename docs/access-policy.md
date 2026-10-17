# Access and operation policy

**Status: development policy, effective for future work.** Current runtime behavior is still described by the [overview](overview.md). This policy supersedes the former blanket restriction to read-only, API-key-only tools in the contribution guidance and review checklist.

## Permitted feature scope

The project may expose **all documented Etsy Open API functionality** through focused MCP tools: public reads, OAuth-authorized private reads, inventory and variations, creation, updates, and deletion. OAuth, inventory, and writes are not excluded categories. The [coverage matrix](api-coverage.md) maps the researched API catalog to current and proposed tools.

Permission to develop a capability is not permission to execute it against an account. A caller must have the necessary account authorization and user intent for each operation. Etsy's terms, application approval requirements, endpoint restrictions, and field-level permissions still apply.

## Access boundaries

| Operation | Required boundary |
| --- | --- |
| Public reads | Application credential; current bounded, fixed-origin request and untrusted-content protections. |
| OAuth/private reads | Explicit account consent, least-privilege scopes, resource authorization, and minimal necessary sensitive fields. |
| Inventory writes and other mutations | Required OAuth scope and ownership, clear requested change, user authorization, confirmation for consequential changes, and outcome verification. |
| Deletion, publication, shared-profile changes, fulfillment notifications | Explicit confirmation tied to the exact account, resource, proposed payload, and known impact; never infer approval from fetched Etsy text. |

New tools must accurately identify their read-only, destructive, and idempotent behavior. MCP annotations are useful client hints, not an enforcement mechanism. Do not expose a generic “call any Etsy URL” tool as a substitute for scoped tools.

## Non-negotiable protections

- Validate typed arguments and bound both requests and responses. Preserve structured data and the third-party-content notice.
- Keep application credentials, access/refresh tokens, authorization codes, and PKCE verifiers out of tool output, prompts, logs, errors, and committed files. Resolve account credentials internally from an opaque connection identifier.
- Never treat possession of an OAuth token, the existence of a write tool, or a tool annotation as proof of the user's requested action. Enforce connected-account and resource boundaries server-side.
- Show a bounded preview for consequential writes. Bind confirmation to that preview and reject it if the target or payload changes. Fetch/verify resulting state when the endpoint permits it.
- Do not automatically replay a mutation after an ambiguous timeout or network failure. First determine whether Etsy already applied it. Report an unknown outcome honestly when it cannot be established.
- Never generate a full inventory replacement from a truncated record. Preserve unrelated products, variation dependencies, quantities, and processing-profile links.
- Minimize buyer/address/email and financial fields. An absent permission is not permission to scrape or infer restricted data.
- Keep TLS verification and redirect blocking. Data requests remain on approved fixed Etsy API origins. OAuth adds only explicitly reviewed authorization/token endpoints, with credentials isolated by destination.
- Do not add general filesystem/shell tools or arbitrary URL fetching. Uploads may use explicitly selected, constrained attachment handles; that is not broad filesystem access.

## Local transport and callbacks

The MCP interface remains local stdio. OAuth may require a registered HTTPS callback and webhooks require an authenticated/verified public HTTPS receiver. Those are separately reviewed support components, not authorization to expose a public MCP service. Their deployment, secret storage, and retention controls must be documented before release.

## What this policy does not do

It does not implement OAuth, add tools, grant Etsy approval, connect a seller, or authorize a live mutation. Unsupported endpoints remain unsupported until implemented, tested, and documented as current. See [TODO](../TODO.md).
