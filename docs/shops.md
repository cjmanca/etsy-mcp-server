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

Only public active listings are exposed. Draft, inactive, expired, and sold-out catalog management, shop sections, shipping configuration, and shop editing are not implemented.

## Suggested agent workflow

For a known shop ID, use `get_shop` directly; for a known owner ID, use `get_shop_by_owner`. Otherwise resolve an exact name, preserve the returned shop ID, then fetch catalog pages or reviews. If the name is uncertain, search for candidates first and clarify the intended shop. Do not treat an incomplete lookup as proof that a shop does not exist.
