# Planned orders, payments, and events

**Status: unimplemented proposals.** This slice enables authorized fulfillment and reconciliation, not public competitor sales reporting. All account tools require the [OAuth foundation](planned-oauth-and-accounts.md) and the [access/write policy](access-policy.md). Exact operations are in the [matrix](api-coverage.md).

## M0.1 verified contract findings (2026-10-17)

All receipt, transaction, payment and ledger operations have
[exact contracts](contracts/operations.md). Read the
[fulfillment/financial-unit audit](contracts/README.md#orders-fulfillment-and-financial-units)
and [separate event contract](contracts/README.md#events--separately-audited-guide-contract).
Shipment creation requires application/regional fulfillment eligibility beyond
transactions_w, always emails the buyer, and currently uses application/json
with enhanced package/customs fields (not the older tutorial form example).
Standalone ledger amount/balance and certain adjustment unit scaling remain
unresolved; keep raw integers/currency rather than invent /100. Guide event URL
examples differ from actual listing/product routes: reconstruct validated routes,
never follow resource_url with credentials. Receiver deployment remains M10 work.

## Receipts and transactions

All tools take `connection_id` and shop ID, plus the selection below. Read operations use `transactions_r`; recheck each operation's exact requirements before implementation.

| Tool | Main inputs | User-facing result |
| --- | --- | --- |
| `get_shop_receipts` | Supported created/modified date ranges, paid/shipped/delivered/canceled filters, paging, and receipt sorting. | Bounded order summaries for fulfillment queues and incremental synchronization. |
| `get_shop_receipt` | Receipt ID; explicit need for any sensitive fields. | Order status, money totals, shipment summaries, and selected purchased-product information. |
| `get_receipt_listings` | Receipt ID and supported result controls. | Listings linked to an authorized receipt via `getListingsByShopReceipt`. |
| `get_shop_transactions` | Supported paging/date controls. | Purchased line-item summaries across the shop. |
| `get_receipt_transactions` | Receipt ID and supported paging. | Purchased line items for one order. |
| `get_listing_transactions` | Listing ID and supported paging. | Sales line items for an owned listing, not arbitrary sellers' private sales. |
| `get_shop_transaction` | Transaction ID. | One authorized purchased line item, including applicable variation/SKU/quantity/price data. |

Receipt addresses may require preferred-partnership access in some regions and buyer email requires separate approval. OAuth consent alone does not guarantee those fields. Return unavailable fields honestly and minimize names, addresses, emails, gift messages, and buyer notes by default. Those free-text fields are untrusted data, not workflow instructions.

An order receipt, a purchased transaction, and a payment are different records; do not count them interchangeably. Preserve stable IDs and source timestamps. Date-based sync should overlap/checkpoint deliberately and deduplicate records, not claim snapshot consistency from offset pages.

## Fulfillment mutations

| Tool | Main inputs | Intended effect |
| --- | --- | --- |
| `update_shop_receipt` | Receipt ID; explicit `was_paid`/`was_shipped` changes supported by the endpoint; confirmation. | Update only supported receipt flags, then read/verify the result. |
| `create_receipt_shipment` | Receipt ID, carrier/tracking data and any supported notification fields; confirmation. | Submit tracking/create a shipment record, explaining any buyer-notification side effect. |

Use `transactions_w` for fulfillment writes, checked against the exact operation. Read current order/shipment state before proposing changes. Confirm the exact receipt and tracking payload; do not create duplicate notifications/shipments after an ambiguous timeout. A tracked shipment is not a purchased shipping label. `updateShopReceipt` is not a generic arbitrary order-status API: the inspected body only exposes paid/shipped flags.

No refund-initiation, arbitrary order cancellation, label-purchase, or buyer-message endpoint appears in the researched catalog. Refund/cancellation data in read responses is not authority to create those actions.

## Payments and ledger reconciliation

These tools take connection ID and shop ID and use `transactions_r`.

| Tool | Required selection | Result |
| --- | --- | --- |
| `get_shop_payments` | Required payment-ID list for `getPayments`. | Payment status, original/posted/adjusted gross, fees, net, and currency context. |
| `get_receipt_payment` | Receipt ID. | Payment associated with one order. |
| `get_ledger_entry_payments` | Endpoint-supported ledger-entry ID selection. | Payments associated with ledger entries, where applicable. |
| `get_shop_ledger_entries` | Required `min_created` and `max_created`; supported paging. | Ledger movements with IDs, sequence, timestamps, amounts/balances, currency, and references. |
| `get_shop_ledger_entry` | Ledger-entry ID. | One ledger movement for drill-down. |

The inspected `getPayments` schema requires `payment_ids` despite its broad “list payments” description: do not promise an unfiltered financial crawl. Discover relationships through receipts/ledger entries when appropriate. An unrelated ledger entry may have no payment. Preserve original versus posted versus adjusted values and currencies; a net payment is not a shop's profit. Money objects use their own amount/divisor/currency. Standalone ledger/payment adjustment integers require field-specific documented units, not an assumed divisor for every field.

## Events and change notifications

The webhook guide documents order events (`paid`, `canceled`, `shipped`, `delivered`), listing events (`created`, `updated`, `deleted`), and inventory events (`created`, `updated`, `deleted`, `out_of_stock`). These are guide-described capabilities, **not extra REST subscription endpoints** in the 105-operation catalog.

Plan a separate reviewed HTTPS receiver configured through Etsy's Webhook Portal. Keep the MCP transport local stdio. Proposed MCP tools `get_etsy_event_status` and `get_etsy_events` expose receiver health and a bounded, account-isolated event queue using a connection ID and opaque cursor. They do not accept a model-supplied webhook URL, signing secret, or arbitrary resource URL. Portal subscription setup remains an operator task unless a documented management API becomes available.

Required event behavior:

- Verify the signature over the original raw body and required headers before processing; reject stale/future timestamps outside the configured replay window.
- Deduplicate by delivery/event identity and handle repeated, delayed, and out-of-order notifications. A notification is not a fresh complete record.
- Reconstruct approved API routes from validated IDs when refreshing a resource; never blindly fetch `resource_url` with credentials. Guide examples and catalog paths can differ.
- Enforce the connected shop boundary, minimize retained payloads, and document cursor, retention, acknowledgment, and queue-overflow behavior.
- Refresh through the existing authorized read tools; deletion events may legitimately lead to not-found reads. Never interpret an incoming event as permission to write.
- Confirm current application eligibility and event availability with Etsy; a local implementation does not grant portal approval.

## Acceptance criteria

- [ ] Receipt/transaction filters reach only documented query fields and return bounded, authorized samples.
- [ ] Restricted buyer fields can be absent without breaking order summaries or leaking raw upstream bodies.
- [ ] Fulfillment tests cover already-shipped orders, invalid tracking, explicit confirmation, notification impact, and uncertain outcomes.
- [ ] Payment-ID and required ledger-date validation happen before requests; reconciliation preserves money units, currencies, and record relationships.
- [ ] Event tests reject invalid signatures/replays and cross-shop payloads, handle duplicates/out-of-order delivery, and never follow arbitrary URLs.

Dependencies: OAuth and privacy controls before account reads; corresponding read tools and mutation confirmation before fulfillment writes; receiver deployment/signing-secret handling before events.
