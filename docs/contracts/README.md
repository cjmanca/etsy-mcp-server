# Etsy operation contracts — M0.1 audit

**Audited 2026-10-17; documentation only. No new capability is implemented.**
The 105 matrix operation IDs and HTTP methods exactly match the current official
OpenAPI document. None was removed; one is explicitly feedback-only/501, and
several have access or rollout restrictions. M0.1 records those blockers; it does
not certify production eligibility or complete M0/M1–M11.

## Contract artifacts and provenance

- [etsy-openapi.json](etsy-openapi.json) is the **original 911,622 bytes**, not a
  filtered schema export. Source:
  <https://www.etsy.com/openapi/generated/oas/3.0.0.json>, retrieved 2026-10-17.
  SHA-256: `be4562b645fd6fa177b823c067037378c6e69ca2eec1ea7d054654088aad77c7`.
  The official [reference page](https://developers.etsy.com/documentation/reference/)
  loads this URL through its `0b4836a8.26d78879.js` Redoc bundle.
- [operations.md](operations.md) has a section for **every** operation: subsystem,
  method/path, security, inputs/flags/bounds/defaults/enums, request encoding,
  response content/schema references, mutation semantics and audit exceptions.
- [operations.json](operations.json) is the machine-readable index with source
  JSON Pointers, security, boundaries and mutation/audit annotations. Resolve
  `sourcePointer` against `etsy-openapi.json` to obtain the entire original
  operation and follow local `$ref`s for nested fields. The **pair**, not the
  index alone, is the complete machine-readable contract.
- [annotations.json](annotations.json) contains human audit findings. Regenerate
  indexes with `python docs/contracts/audit.py --write`; check offline with
  `python docs/contracts/audit.py`. The audit verifies checksum, all local refs,
  105 unique matrix/official IDs, methods, operation pointers, annotation IDs and
  deterministic index contents. It does not prove real account access.

No constraints have been reconstructed from memory. All original descriptions,
`required`, numeric/string/array bounds, enums, defaults, nullable flags,
serialization settings, request encodings and response status/body/header shapes
remain in the snapshot, including constraints only stated in prose. Missing
`maximum`/`maxLength`/`maxItems` is **not** permission for unbounded MCP input.
The local safe-integer IDs, search length, offset, response limits and other
[safety contracts](../response-handling-and-safety.md) remain stricter where needed.
OpenAPI 64-bit integers can exceed JavaScript safe integers; do not silently round.

Security is interpreted literally: alternatives in `security` are OR; schemes
and scopes in a single requirement are AND. All requests require the guide's
`x-api-key: <keystring>:<shared_secret>`; OAuth is additional where required.
Schema presence is not proof that a field is returned, an account owns a resource,
or a feature is approved. For private reads/writes enforce actual granted scopes,
connected-account/resource relationships and minimal sensitive output. When the
reference does not specify further ownership behavior, that behavior remains
unproven, not universally authorized. Do not probe live accounts to fill gaps.

Guide source URLs below are the official Markdown representations, retrieved
2026-10-17. Their public pages use `/documentation/` in place of `/markdown/`
and omit `.md`. Checksums identify inspected source revisions; guide copies are
not vendored. They are supporting prose, not additional REST operations.

| Source suffix under `https://developers.etsy.com/markdown/` | SHA-256 |
| --- | --- |
| `essentials/authentication.md` | `3efbc4147727a63beef2621671b6a5de9cb48bf23f80de6433519331a7463790` |
| `essentials/requests.md` | `dc9c472b5753121c6a3ae2f9c9fe002949f5807371477c08d6a141c14991c34d` |
| `essentials/webhooks.md` | `ab72a06fc72ac3eb03ffb05a0a52ad69ddcfc3b19814974495c597b9e0b2ed01` |
| `tutorials/inventory-shipping-data-migration.md` | `5c232d1a9e6da7050a69580d75dc2d484a9bd2ce706754e048c3b07c5ffb958b` |
| `tutorials/migration.md` | `a44160f399763046f9a62c9f6197924a22925bbdacddefdbdf99450011ce0ca7` |
| `tutorials/listings.md` | `9ade5ee2be3ed5ff8bfc3628780054ef95e05c3e1fa4cd0d4096e967aa5ea2fd` |
| `tutorials/third-variation.md` | `16b159cd91c471006edbb0c1bfbe568bc067975f435f1c05ad2aacc70bf48de6` |
| `tutorials/personalization-migration.md` | `89ed3e93a5a51aafb73777a7d210c1f4d8f1732a571d84d267b888e926fac530` |
| `tutorials/personalization-addon-pricing.md` | `79ca1b85ac1a074fa10d7541a798cc7426c1d94a5323c2ed021efdc2c8bffee5` |
| `tutorials/payments.md` | `2a3ce52021c7a2bb7e18af7386ad43bceda4cd1cc92afdf395a6b01e27e4c8c6` |
| `tutorials/fulfillment.md` | `f7f0df69b8f99d35a118ddae45bd11fc5d163098a09ad68c719aa1f27e3d25ee` |
| `tutorials/shopmanagement.md` | `b74798912080d2c24239b05d9d122ba92e93ad7eca9430d6298c367b4904f2e5` |

The public inventory/shipping URL uses `inventory-shipping-migration`, whereas
its Markdown source uses `inventory-shipping-data-migration`. The former
Markdown slug and `tutorials/personalization.md` returned 404; the correct
official sources above were used instead. No MCP fallback was needed.

## Six existing-tool extension checks

These are audit findings, **not changes to the current tools**.

| Existing tool | Current upstream operation(s) | Extension/compatibility contract |
| --- | --- | --- |
| `search_listings` | `findAllListingsActive` | Upstream supports taxonomy_id, shop_location, is_safe, currency, buyer_country; buyer country filters shipping eligibility. Retain required keywords and all current bounds. score always desc regardless of requested order. Currency conversion is a separate nullable Money value. |
| `get_listing_details` | `getListing` | Includes enum: Images, Shop, User, Translations, Videos, Personalization, BuyerPrice. Keep existing four includes compatible; proposed translation/personalization use declared language/association fields. Inventory/Shipping removed. BuyerPrice remains batch-only by field description, despite enum. No currency/buyer_country/legacy query here. allow_suggested_title needs owner OAuth with unspecified exact scope: disabled until clarified. |
| `get_shop_by_name` | `findShops`, then `getShop` | No exact-match parameter exists. Keep bounded five-page/500-candidate local case-insensitive matching, ambiguity/incomplete outcomes and follow-up profile lookup; direct numeric tool is separate future work. Frozen/removed shops can rarely appear in search. |
| `get_shop_listings` | `findAllActiveListingsByShop` | Supported shop_id, limit, offset, sort_on, sort_order, keywords only; sort depends on search options. Do not silently switch to scoped getListingsByShop or copy global advanced filters. Rich summaries only from returned permitted fields. |
| `search_shops` | `findShops` | Required shop_name, optional limit/offset; no invented country/sort/exact flags. Existing search-string/output bounds retained. |
| `get_shop_reviews` | `getReviewsByShop` | shop_id, limit, offset, min_created/max_created (minimum 946684800). No sort or write options. Keep bounded sample fields and buyer-identity minimization. |

Listing `readiness_state_id` is only returned for active physical listings on a
shop-scoped route or single-listing request; other cases can be null. General
listing `price` is the minimum possible price, not a precise offering quote.
BuyerPrice requires batch `buyer_country`; UK display prices include shipping,
others use base price; null shipping means free **or unavailable**, distinguished
with `is_free_shipping`. Preserve base/display/discount/original/converted money.
Do not use enum membership to override the batch-only response-field restriction.

## Public discovery blockers and routing corrections

- `getListingProperty` advertises **Feedback only** and says it returns **501
  only**, despite a useful response schema. M2.5's single-property detail cannot
  ship until Etsy releases it. `getListingProperties` remains a separately
  documented operation, not an invented equivalent detail endpoint.
- `getListingsByShopReturnPolicy` requires **listings_r** and declares no paging
  query. Move only this part of M2.7 behind OAuth; policy list/detail stay public.
- `getListingVariationImages` and `getListingOffering` are API-key-only in the
  official contract; neither inherits `listings_r` from adjacent inventory reads.
- Taxonomy operations return the full tree. Local filtering/cache/bounded
  acquisition strategy remains M1.1 work; this audit did not measure live trees
  or relax the 1 MiB global upstream cap.
- Section listing lookup uses a required `shop_section_ids` query array at
  `/shops/{shop_id}/shop-sections/listings`, not a fabricated section detail path.

## Listing, inventory and migration semantics

Dedicated batch inventory/shipping replace removed Inventory/Shipping includes.
Both accept up to 100 IDs in prose; any missing ID fails the whole call with 404.
Inventory requires listings_r; other sellers' SKUs become empty strings. A null
inventory record is not proof of zero stock. Shipping requires shops_r; foreign
owner profile **and ID** are nulled, and digital profiles may be absent.

Inventory PUT replaces the entire product set. Read a complete internal snapshot,
preserve unrelated products, all four `*_on_property` arrays, quantities, SKUs,
enabled states, property scales and readiness links. Remove response-only
product_id/offering_id/scale_name/is_deleted/value_pairs before writing; price
becomes decimal amount/divisor. Never construct a replacement from a display
excerpt. This API supplies no verified atomic compare-and-swap guarantee.

Third-variation guide says query `max_variations_supported=3` is required even
when editing/removing the third variation of an existing three-variation listing.
Schema encodes it as **string** enum `"2"`, `"3"`, whereas guide calls it integer;
wire query uses `3`. Without it, three-variation writes fail (guide examples
disagree between 400 and 409: support both, do not promise one exact status).
Guide limits: one variation 70 products; two 4900; three 2500; varying by all
properties 400 (third-variation guide applies this to two or three variations).
Dependency arrays may have zero, one, or all variation IDs; with three variations,
two IDs are invalid; if any varies by all, others must be empty or all. Sending
fewer properties with support=3 **deletes** omitted variations.

`enable_scale_validation` is a temporary boolean inventory-write query that
will be removed when validation becomes mandatory; do not build a bypass into
the MCP. Third-variation guide still describes developer-mode enrollment before
general audience launch, without proving that launch has occurred. Production
eligibility is an explicit release gate, not a reason to omit the contract.
The guide's old includes=Inventory example is superseded by the dedicated-endpoint
migration; do not copy it.

Draft creation uses form encoding and does not publish. PATCH `updateListing`
supports active/inactive state only; draft activation publishes and needs images;
sold-out activation renews and sets quantity=1. Physical activation validates
complete shipping; digital not-made-to-order activation needs an uploaded file.
Active physical return_policy_id is required except for EU shops per field prose.
Listing deletion has specific permitted states/availability/seller flags in its
operation description, not a universal any-state delete rule.

Current create/update schema additionally includes `ecgt_*` guarantee/service
fields: guarantee brand <=25, model <=20, years 3–99, details <=255, with all four
primary guarantee fields required if any supplied nonempty. Eligibility and
physical/digital restrictions can cause fields to be silently ignored. Other
service/software fields have separate type/eligibility rules. Preserve exact
prose in the snapshot; do not infer legal compliance from accepted payloads.
Title character regex and one-use %, :, &, +; tag/material/style regex and style
max-two/45-character limits also live in descriptions, not schema keywords.

File upload can convert physical to digital and erase shipping/variations;
last-file deletion converts digital to physical. Image/video removal detaches
but does not erase retained binaries. Images process asynchronously. All upload
schemas use multipart; source handles/limits remain M5.4 work. Video description
offers `is_multi_video=true` for two videos but declares no corresponding query
or body field: **block the multi-video extension pending wire clarification**.
Do not guess upload size/format limits absent from these contracts.

## Processing profiles and shop configuration

The migration guide says physical-only processing profiles, irreversible move
from shipping-profile processing, `legacy=false` during transition, no legacy
parameters with that flag (400), and **test shops only/no real sellers until an
official go-live announcement**. Current endpoints instead display **General
Release**. Neither the old guide date nor the banner resolves this conflict:
**block production processing enablement until current Etsy rollout is clarified**.
No live account or deployment decision is needed to finish this documentation.

Only these 14 operations declare `legacy` in the captured contract:
getListingProduct, getListingOffering, getListingsByListingIds,
getFeaturedListingsByShop, getShopReceiptTransactionsByListing, getShopReceipt,
updateShopReceipt, getShopReceipts, getListingsByShopReceipt,
createReceiptShipment, getShopReceiptTransactionsByReceipt,
getListingsByShopReturnPolicy, getListingsByShopSectionId,
getShopReceiptTransactionsByShop. **Do not add it indiscriminately**, particularly
not to current getListing/getListingInventory/createDraftListing/updateListing/
updateListingInventory or readiness CRUD, where it is not declared. These
guide/reference differences are unresolved, not authorization to invent flags.

Readiness CRUD uses shops_r for reads/shops_w for writes. Creation/update of
duplicate definitions conflicts with Content-Location pointing to existing data;
validate/reconstruct approved routes rather than following arbitrary headers.
Deletion fails while active offerings are linked; reassignment is a separate
confirmed operation. Updates affect every linked offering; profile creation alone
does not assign offerings. Processing time weeks means five business days.

`updateShop` requires **both shops_r and shops_w**, primary-language strings and
EU-only policy_additional. Shipping profile/destination country and region are
mutually exclusive; carrier/mail_class pair or min/max delivery pair required.
Destination creation with neither country nor region defaults to everywhere.
Calculated-profile creation is unsupported (existing Manager-created calculated
profiles can be linked). Final destination cannot be deleted; upgrades/destinations
affect every linked listing. Holiday operations are US/CA only; fulfillment guide
maps IDs 1–23 while schema enum spans 1–105: use returned region-applicable data.
Return acceptance needs deadline; deletion needs zero linked listings;
consolidation moves **all** source listings and **deletes source policy**.

## Personalization contract beyond schema keywords

Dedicated POST is a **full replacement**, not partial question editing. Migration
guide supersedes deprecated single-field writes (which now error); preserve all
seller questions and IDs from a complete read. Question IDs/options may change
on update. `supports_multiple_personalization_questions=true` is needed for
multiple/new types; omission can reject destructive replacement with 409. Schema
question_type prose still says only single text is supported despite four enum
values and the migration guide: verify eligibility before exposing new-type writes.

Guide constraints: 1–5 questions; at most one upload question; question_text 1–45,
starts alphanumeric, no more than one word starting with 3+ capitals. Instructions
<=120 with the same textual rules, absent/empty/null for dropdown; older longer
GET values remain intact and may not be blindly written back. Text requires
max_allowed_characters 1–1024 and disallows files/options; uploads require
max_allowed_files 1–10; labeled upload minimum two and matching label count.
Dropdown requires 1–30 unique options with labels 1–20; labeled-upload labels 1–45.
Fields not appropriate to type must not be sent.

Add-on pricing applies only to optional text_input (`required:false`). GET gives
Money or null; write takes shop-currency decimal, range USD 0.20–500 equivalent.
Explicit zero/null removes pricing; preserve/change by explicit decimal value.
During 30-day migration, omission on matching question_id preserves price; after
that it errors if existing price present. The guide gives no calendar anchor:
do not assume current day-of-rollout or rely on omission. Transaction variations
may include multiple property_id 54 entries with seller-defined names and upload
URLs; those URLs are data, not permission to fetch. DELETE disables and removes
personalization and sets is_personalizable=false.

## Account, callback and token contracts

getUser requires email_r and is limited to self/linked buyers; primary_email needs
app approval. getMe requires shops_r. Address reads use address_r.
**deleteUserAddress conflict:** operation says address_r, guide scope summary says
address_w permits deletion. Preserve the exact recorded security and block
production deletion until Etsy confirms; do not silently substitute a guessed
scope. tokenScopes is API-key POST with secret token body, not a seller mutation;
model-facing tools must resolve the token internally.

OAuth is supporting protocol, not a 106th catalog operation: consent GET
`https://www.etsy.com/oauth/connect` with response_type=code, keystring client_id,
registered exact HTTPS redirect, space-delimited scopes, PKCE S256 and state.
Verifier 43–128 unreserved characters; challenge SHA256/base64url. Current guide
makes state recommended and token-exchange redirect_uri optional for OAuth2.1;
repository policy deliberately still requires single-use bound state and exact
registered redirect handling. Success callback code/state and denied-consent
error/error_description/error_uri are untrusted; verify state before exchange,
never fetch error_uri or expose codes/tokens/errors verbatim.

Token POST `https://api.etsy.com/v3/public/oauth/token`, form-urlencoded UTF-8:
authorization_code + client_id + code + code_verifier (and matching redirect_uri
when used); refresh_token grant + client_id + refresh_token for refresh. The guide
has an erroneous `refresh_code` bullet/query example: use its formal
refresh_token body contract. Access ~1h, refresh ~90d, honor actual expires_in;
scope response can be reduced, refresh cannot expand scopes. Preserve user-ID
prefix in bearer tokens and protect rotations. No supported revocation REST
operation appears here; local disconnect must not claim upstream revocation.
Storage/callback deployment choices remain M3.1, not blockers to this audit.

## Orders, fulfillment and financial units

All receipt/transaction/payment reads are transactions_r; receipt and shipment
writes transactions_w. Regional address fields require preferred partnership;
buyer_email requires app approval. Receipt update exposes only paid/shipped flags.
**Shipment access is restricted beyond OAuth** by app/region eligibility. Reference
lists approved commercial Fulfillment/Print-On-Demand, personal app owned by seller,
or pre-regional-program authorization cases; guide warns valid commercial/scoped
apps can still get 403 and need Etsy approval. Treat eligibility as a release gate.
Every successful shipment submission emails buyer, send_bcc also seller; duplicate
or uncertain submissions must not be replayed. Tracking/carrier required for US
orders >$10 or India destinations; `other` supports unlisted carriers.

Current shipment body is **application/json**, despite guide's older form example.
It includes mail class, weights/units/dimensions, label price/currency, origin/
destination, incoterm, duties, ship_date and customs_data (with required nested
country_of_origin/declared_value/HS_code when supplied). Guide ship_date is UTC
ISO8601 and malformed dates are silently ignored. No label-purchase capability
is implied by reporting shipping-label cost.

Payments require explicit payment_ids; ledger list requires min_created/max_created;
relationship lookup uses ledger_entry_ids. Tutorial unfiltered payments, NaN
timestamps, missing-shop routes and ledger_id wording must not override schemas.
Payments may not exist until posting/fulfillment; unrelated ledger entries may
have no payment. No refund-initiation operation exists.

| Data | Recorded units and audit rule |
| --- | --- |
| Money, including Payment amount/posted/adjusted fields | Use actual amount/divisor/currency_code; prose saying integer pennies does not override object shape. Reject divisor<=0 for display, although schema permits zero. Null posted/adjusted values are not zero. |
| Ledger entry amount/balance | Standalone integer plus currency; no explicit divisor/minor-unit definition in inspected reference/guide. Preserve raw integers/currency and mark scaled display unresolved; do not assume /100. |
| payment_adjustments container | Says monetary amounts USD pennies unless otherwise specified. This is not permission to flatten all currencies. |
| PaymentAdjustment total_adjustment_amount, shop_total_adjustment_amount, buyer_total_adjustment_amount | Field descriptions specify payment/shop/buyer currency respectively; no explicit field divisor. Preserve raw/unit context, do not relabel all USD. total_fee_adjustment_amount has no precise per-field currency/scaling clarification. |
| PaymentAdjustmentItem amount/shop_amount | Field prose specifies original/shop currency; raw integer default 0, no explicit divisor. Preserve raw context pending clarification. |

## Events — separately audited guide contract

Guide enumerates 11 events: order.paid/canceled/shipped/delivered;
listing.created/updated/deleted; inventory.created/updated/deleted/out_of_stock.
Listing updates cover title/description/personalization/taxonomy/images/attributes/
state; inventory updates cover price/readiness/SKU/state. No extra REST subscription
operations exist. Portal setup/eligibility and separately bounded HTTPS POST
receiver remain operator/implementation work; both personal and commercial apps
are described as supported although portal screenshots mention commercial.

Common payload: event_type, resource_url, shop_id; listing adds listing_id;
inventory adds listing_id/product_id. Order payload lacks explicit receipt ID,
so validate/extract it from an allowlisted receipt path without fetching the URL.
Webhook example shop-scoped listing/product paths conflict with catalog routes;
reconstruct actual routes from validated IDs, never forward credential-bearing
requests to resource_url. Payload is a notification, not complete current state.

Verify raw bytes using webhook-id + '.' + webhook-timestamp + '.' + raw_body;
strip whsec_ from secret, base64-decode key, HMAC-SHA256, base64 output, compare
against accepted signature entries with constant-time checks. Reject unsupported
version/invalid entries; exact multi-signature/version parsing needs implementation
fixtures because guide only says compare any entry. Guide example replay tolerance
is +/-300 seconds, not an instruction to accept arbitrary old retries. Dedupe
webhook-id (stable even on retry), enforce shop boundary, and safely refresh via
authorized reads. Guide retries: immediate, 5 seconds, 5 minutes, 30 minutes,
2 hours, 5 hours, 10 hours, another 10 hours; manual portal retries can occur later.
No delivery-order/exactly-once guarantee. Queue retention/overflow/cursors and
secret rotation remain reviewed M10 work, not inferred API promises.

## Release blockers versus completed analysis

Recorded blockers are actionable limits on future implementation: 501 detail,
address-delete scope conflict, suggested-title exact scope, processing/third-variation/
personalization rollout inconsistencies, multi-video wire flag, shipment eligibility,
and ambiguous standalone financial scaling. No replacement endpoints, approval,
go-live date, atomicity or extra flags have been invented. Revalidate affected
operations before coding/live enablement; keep these product tasks outstanding.
