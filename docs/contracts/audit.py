"""Offline M0.1 documentation audit, not runtime code or a live API client.

python docs/contracts/audit.py --write regenerates the review indexes.
python docs/contracts/audit.py verifies them without writing or networking.
Original OpenAPI bytes must not be normalized by this script.
"""

import hashlib
import html
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SHA256 = "be4562b645fd6fa177b823c067037378c6e69ca2eec1ea7d054654088aad77c7"


def pointer(value):
    return value.replace("~", "~0").replace("/", "~1")


def resolve(ref, spec):
    assert ref.startswith("#/"), f"Unexpected external reference: {ref}"
    result = spec
    for token in ref[2:].split("/"):
        result = result[token.replace("~1", "/").replace("~0", "~")]
    return result


def check_refs(value, spec):
    if isinstance(value, dict):
        if "$ref" in value:
            resolve(value["$ref"], spec)
        for child in value.values():
            check_refs(child, spec)
    elif isinstance(value, list):
        for child in value:
            check_refs(child, spec)


def plain(text):
    # Strip only presentation banners/HTML; exact original prose remains in JSON.
    text = text.split("</div>\n\n")[-1]
    return html.unescape(re.sub("<[^>]+>", "", text)).strip().replace("\n", " ").replace(
        "](/documentation", "](https://developers.etsy.com/documentation")


def compact(value, property_map=False):
    # Tables are navigational; all descriptions/constraints remain in source JSON.
    if isinstance(value, dict):
        return {k: compact(v, k == "properties") for k, v in value.items()
                if k != "description" or property_map}
    if isinstance(value, list):
        return [compact(v) for v in value]
    return value


def main():
    source = (HERE / "etsy-openapi.json").read_bytes()
    assert hashlib.sha256(source).hexdigest() == SHA256, "Snapshot checksum changed"
    spec = json.loads(source)
    check_refs(spec, spec)
    notes = json.loads((HERE / "annotations.json").read_text(encoding="utf-8"))
    catalog = {}
    section = ""
    for line in (ROOT / "docs/api-coverage.md").read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            section = line[3:]
        match = re.match(r"\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \|", line)
        if match:
            method, operation_id = match.groups()
            assert operation_id not in catalog, operation_id
            catalog[operation_id] = (method, section)
    operations = {}
    for path, item in spec["paths"].items():
        for method, operation in item.items():
            if not isinstance(operation, dict) or "operationId" not in operation:
                continue
            operation_id = operation["operationId"]
            assert operation_id not in operations, operation_id
            assert catalog[operation_id][0] == method.upper(), operation_id
            operations[operation_id] = (path, method, operation)
    assert len(catalog) == len(operations) == 105
    assert catalog.keys() == operations.keys(), "Matrix/catalog mismatch"
    assert set(notes) <= set(operations), "Orphan annotations"
    # Regression checks for the audit's consequential contract corrections.
    def op(name):
        return operations[name][2]
    def params(name):
        return {p["name"]: p for p in op(name).get("parameters", [])}
    assert "501" in op("getListingProperty")["description"]
    assert op("getListingsByShopReturnPolicy")["security"] == [{"api_key": [], "oauth2": ["listings_r"]}]
    assert not {"limit", "offset"} & params("getListingsByShopReturnPolicy").keys()
    assert op("deleteUserAddress")["security"] == [{"api_key": [], "oauth2": ["address_r"]}]
    assert op("updateShop")["security"] == [{"api_key": [], "oauth2": ["shops_r", "shops_w"]}]
    assert op("getListingVariationImages").get("security", spec["security"]) == [{"api_key": []}]
    assert op("getListingOffering").get("security", spec["security"]) == [{"api_key": []}]
    assert params("updateListingInventory")["max_variations_supported"]["schema"]["enum"] == ["2", "3"]
    assert "enable_scale_validation" in params("updateListingInventory")
    assert "supports_multiple_personalization_questions" in params("updateListingPersonalization")
    assert "legacy" not in params("updateListingInventory")
    assert "application/json" in op("createReceiptShipment")["requestBody"]["content"]
    assert params("getPayments")["payment_ids"]["required"]
    assert params("getShopPaymentAccountLedgerEntries")["min_created"]["required"]
    assert params("getShopPaymentAccountLedgerEntries")["max_created"]["required"]
    assert set(params("findAllListingsActive")) >= {"taxonomy_id", "shop_location", "is_safe", "currency", "buyer_country"}
    assert set(params("findAllActiveListingsByShop")) == {"shop_id", "limit", "offset", "keywords", "sort_on", "sort_order"}
    assert "allow_suggested_title" in params("getListing")
    assert set(params("findShops")) == {"shop_name", "limit", "offset"}
    assert set(params("getReviewsByShop")) == {"shop_id", "limit", "offset", "min_created", "max_created"}
    assert set(params("getShop")) == {"shop_id"}
    example = {"properties": {"description": {"type": "string", "description": "prose"}}}
    assert compact(example) == {"properties": {"description": {"type": "string"}}}
    output = ["# Per-operation contract index", "",
              "Generated by `python docs/contracts/audit.py --write`. Read [audit findings](README.md) first.", "",
              "Every row is accounted for below, including blocked operations. Exact original descriptions, input constraints/defaults/enums, serialization overrides, request bodies, response codes/content/headers and all nested schemas are retained without transformation in [etsy-openapi.json](etsy-openapi.json). JSON Pointers below identify the complete operation; follow local `$ref` values into `components`. Tables omit descriptions only for readability, not from the contract snapshot.", "",
              "Security arrays are OpenAPI alternatives (OR); schemes and scopes inside one requirement are combined (AND). All calls also follow the request guide's full x-api-key requirement. No automatic retry/idempotency guarantee is established for writes. Each mutation needs connected-owner checks, exact payload approval and read-back/unknown-outcome handling under repository policy. Schema presence does not prove field entitlement or rollout eligibility.", ""]
    records = []
    for operation_id in sorted(operations):
        path, method, operation = operations[operation_id]
        scoped = any(x.get("oauth2") for x in operation.get("security", spec["security"]))
        boundary = ("Enforce granted scopes and connected-account/resource relationship; minimize sensitive fields. "
                    if scoped else "API-key baseline; do not infer access to private/owner-only fields. ")
        boundary += "Additional operation/field restrictions are in original descriptions and referenced schemas; absence of a stated restriction is not an entitlement guarantee."
        semantics = ("Read only." if method == "get" else
                     "Credential-bearing scope inspection, not a shop mutation; resolve token internally." if operation_id == "tokenScopes" else
                     "Mutation: " + plain(operation.get("description", "")))
        record = {"operationId": operation_id, "method": method.upper(), "path": path,
                  "sourcePointer": f"#/paths/{pointer(path)}/{method}",
                  "matrixSection": catalog[operation_id][1],
                  "security": operation.get("security", spec["security"]),
                  "ownerFieldBoundary": boundary, "mutationSemantics": semantics,
                  "auditNotes": notes.get(operation_id, "No additional guide-specific exception identified; apply subsystem findings and exact source contract.")}
        assert resolve(record["sourcePointer"], spec) == operation
        records.append(record)
        output += [f"## {operation_id}", "", f"`{method.upper()} {path}`", "",
                   "Matrix subsystem: " + re.sub(r"\]\((?!https?:)([^)]+)\)",
                       r"](../\1)", catalog[operation_id][1]), "",
                   f"Source JSON Pointer: `{record['sourcePointer']}`", "",
                   "Security: `" + json.dumps(record["security"]) + "`", "",
                   "Reference description: " + plain(operation.get("description", "")), "",
                   "Owner/field boundary: " + boundary, "",
                   "Audit: " + record["auditNotes"], "",
                   "Mutation semantics: " + semantics, "",
                   "### Inputs", "", "| Location | Name | Required | Schema (descriptions in source) |",
                   "| --- | --- | --- | --- |"]
        for parameter in item_parameters(spec, path, operation):
            output.append("| " + " | ".join([parameter["in"], f"`{parameter['name']}`",
                          str(parameter.get("required", False)).lower(),
                          "`" + json.dumps(compact(parameter.get("schema", {})), ensure_ascii=True).replace("|", "&#124;") + "`"]) + " |")
        body = operation.get("requestBody")
        output += ["", "Request body: " + ("none declared." if body is None else
                   "`" + json.dumps(compact(body), ensure_ascii=True).replace("|", "&#124;") + "`"), "",
                   "Responses (all fields/constraints and headers in source): `" +
                   json.dumps(compact(operation["responses"]), ensure_ascii=True).replace("|", "&#124;") + "`", ""]
    artifacts = {"operations.json": json.dumps(records, indent=2, ensure_ascii=False) + "\n",
                 "operations.md": "\n".join(output)}
    for name, content in artifacts.items():
        if "--write" in sys.argv:
            (HERE / name).write_text(content, encoding="utf-8", newline="\n")
        else:
            assert (HERE / name).read_text(encoding="utf-8") == content, f"Stale {name}"
    print("PASS: 105 unique matrix operations = 105 official operations; methods match; all local $refs and operation pointers resolve; SHA-256 matches; 2 review indexes reproducible.")
    print("PASS: consequential access/flag/encoding corrections and six existing-tool upstream parameter contracts checked; real description input property preserved in compact review tables.")


def item_parameters(spec, path, operation):
    parameters = {(p["in"], p["name"]): p for p in spec["paths"][path].get("parameters", [])}
    parameters.update({(p["in"], p["name"]): p for p in operation.get("parameters", [])})
    return parameters.values()


if __name__ == "__main__":
    main()
