# Shop discovery and catalogs

**Status: implemented.** Use this slice to find shops, resolve names safely, and browse active catalogs. See [reviews](reviews.md) for customer feedback and [response handling](response-handling-and-safety.md) for shared limits.

## Search for candidate shops

`search_shops` requires `shop_name`, a nonempty search string up to 200 characters. Optional `limit` is 1–100 (default 25); `offset` is 0–12000 (default 0).

Results can include shop ID, name, title, URL, active-listing count, currency, and vacation status. Search results are candidates, not confirmation of an exact identity.

```json
{ "shop_name": "pottery", "limit": 10 }
```

## Resolve an exact name

`get_shop_by_name` takes `shop_name` and looks for an exact, case-insensitive name match. It scans at most five search pages or 500 candidates and stops when it finds exact matches. A unique match on the examined page triggers a public shop-profile lookup.

| Outcome | How an agent should interpret it |
| --- | --- |
| `found: true` | A unique exact match was found on the examined page; use its numeric `shop_id` for subsequent tools. |
| `found: false` | Search results were exhausted without an exact match. |
| `ambiguous: true` with `matches` | Multiple exact matches were observed; do not silently pick one. |
| `status: "incomplete"`, `incomplete: true` | The bounded search could not establish a match or absence. This is **not** a not-found result; `found` is not provided. |

A profile can include shop name/title, announcement, currency, vacation state/message, sale and digital-sale messages, creation timestamps, active-listing count, and URL. `get_shop` exposes the same selected profile directly by shop ID, without name search.

## Look up a known shop or owner ID

`get_shop` requires a positive safe-integer `shop_id` and reads the public shop profile directly. It does not call `findShops` or accept search parameters.

```json
{ "shop_id": 12345678 }
```

`get_shop_by_owner` requires a positive safe-integer `user_id` and asks Etsy for the public shop associated with that owner ID. Etsy documents this as a single `Shop` response; it is not a user-profile lookup or a shop search.

```json
{ "user_id": 123456 }
```

Both tools use public API-key access and return the same selected, bounded profile fields as exact-name lookup. A missing shop/owner is an error, not a fabricated or empty profile. A public owner-ID lookup does **not** establish that the shop belongs to the caller or authorize account access.

## Browse a shop's active products

`get_shop_listings` requires `shop_id` as a positive safe integer. It accepts the shared page controls, optional nonempty `keywords` up to 200 characters, and the same sorting options as [listing search](listing-discovery.md).

```json
{
  "shop_id": 12345678,
  "keywords": "ceramic mug",
  "sort_on": "price",
  "sort_order": "asc",
  "limit": 25,
  "offset": 0
}
```

**Sorting caveat:** Etsy applies shop-listing sorting with search options such as keywords. Passing only a sort field does not guarantee the requested ordering. Returned product summaries are described in [listing discovery](listing-discovery.md).

## Browse shop sections and featured products

The public section tools expose a shop's selected section metadata without fetching a private user profile:

| Tool | Required arguments | Purpose |
| --- | --- | --- |
| `get_shop_sections` | `shop_id` | List section IDs, titles, display ranks, owner user IDs, and active-listing counts. |
| `get_shop_section` | `shop_id`, `shop_section_id` | Read one section using both IDs. |
| `get_shop_section_listings` | `shop_id`, `shop_section_id` | Browse one section's active listings with page and endpoint-declared sort controls. |
| `get_featured_shop_listings` | `shop_id` | Browse the listings the shop has curated as featured. |

`ShopSection` fields are optional in Etsy's response. Missing or null fields may be omitted; an `active_listing_count` of zero and an empty section are valid. Responses include `count`, `returned`, and `truncated` for list tools. They represent one bounded Etsy response, not a guaranteed complete snapshot; inspect those fields before drawing completeness conclusions. Listing summaries reuse the selected bounded fields described in [listing discovery](listing-discovery.md).

For a section's listings, the server sends the selected `shop_section_id` in Etsy's required `shop_section_ids` query array at the shop-section listings route; it does not construct a section-specific `/sections/{id}/listings` URL. The tool accepts one section ID per call. Etsy declares `sort_on` and `sort_order`, but its reference says sorting only takes effect with search options such as keywords or region; this section endpoint declares no keyword filter, so sorting may be ineffective. `score` remains descending regardless of `sort_order`. The optional `legacy` flag is forwarded only when explicitly supplied and is not a processing-profile rollout control.

The featured endpoint accepts only paging controls and its declared optional `legacy` flag: no search, date, or sort control is added. Featured results are **shop-curated selections**, not Etsy-wide trending or popularity rankings. `featured_rank` is included only when Etsy returns it; result order and rank are not inferred or reordered locally. There is no supported platform-wide trending endpoint.

Returned section `user_id` is a public ownership reference, not proof that a section or shop belongs to the caller. Where Etsy returns parent IDs in section/listing data, mismatches against the requested shop or section are rejected. The server does not make a follow-up profile request to guess an absent relationship. Section titles, listing text, tags, and URLs remain untrusted Etsy data.

```json
{
  "shop_id": 12345678,
  "shop_section_id": 42,
  "limit": 25,
  "offset": 0,
  "sort_on": "price",
  "sort_order": "asc"
}
```

Only public active listings are exposed. Draft, inactive, expired, and sold-out catalog management, shipping configuration, and shop editing are not implemented.

## Read public return policies

The public policy list and detail tools use API-key access and make one request each:

| Tool | Required arguments | Purpose |
| --- | --- | --- |
| `get_shop_return_policies` | `shop_id` | List selected public return-policy fields for one shop. |
| `get_shop_return_policy` | `shop_id`, `return_policy_id` | Read one selected public policy. |

They call `GET /v3/application/shops/{shop_id}/policies/return` and `GET /v3/application/shops/{shop_id}/policies/return/{return_policy_id}` respectively. Both IDs must be positive safe integers. Etsy declares no query parameters for either operation, so these tools do not accept paging or other filters.

The list selects only `return_policy_id`, `shop_id` when supplied, `accepts_returns`, `accepts_exchanges`, and `return_deadline`. The nullable deadline, when non-null, is one of Etsy's documented values: 7, 14, 21, 30, 45, 60, or 90 days. `count` is retained only when Etsy supplies it and, when supplied, must match the complete unpaged `results` length before local trimming; a mismatch is treated as malformed source data. `returned` counts displayed rows and `truncated` reports local shortening. A valid empty list has `results: []`; a missing or malformed `results` field is an error, not an empty result. The unpaged response is capped at 100 policies and the shared 128 KiB JSON bound. Detail selects the same policy fields without inventing omitted IDs or making a follow-up ownership lookup. Explicit `false`, `null` deadlines, zero source counts, and absent fields remain distinct.

```json
{ "shop_id": 12345678 }
```

```json
{ "shop_id": 12345678, "return_policy_id": 42 }
```

These tools report structured Etsy fields only. They do not provide legal advice, guarantee legal compliance or refund eligibility, or enumerate affected listings. `get_return_policy_listings` is a separate planned private read requiring completed OAuth scope authorization and `listings_r`; it is not currently exposed. Public policy reads do not imply seller ownership.

## Suggested agent workflow

For a known shop ID, use `get_shop` directly; for a known owner ID, use `get_shop_by_owner`. Otherwise resolve an exact name, preserve the returned shop ID, then fetch active or section catalog pages, shop-curated featured listings, or reviews as needed. If the name is uncertain, search for candidates first and clarify the intended shop. Do not treat an incomplete lookup as proof that a shop does not exist.
