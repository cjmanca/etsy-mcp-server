import assert from "node:assert/strict";
import { AxiosError } from "axios";
import test from "node:test";
import { createEtsyMcpServer } from "../build/index.js";
import {
  httpError,
  jsonText,
  mockAdapter,
  successResponse,
  syntheticKey,
  withMcp,
} from "./helpers/mcp.js";

const taxonomyTree = (id, name) => ({
  count: 1,
  results: [{ id, name, level: 0, parent_id: null, children: [] }],
});

test("taxonomy property tool is discoverable with a selector, ID, seller filters, and read annotations", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] })),
    async ({ client }) => {
      const { tools } = await client.listTools();
      const tool = tools.find((candidate) => candidate.name === "get_taxonomy_properties");

      assert.ok(tool, "get_taxonomy_properties is discoverable");
      assert.deepEqual(tool.inputSchema.required, ["taxonomy_type", "taxonomy_id"]);
      assert.deepEqual(tool.inputSchema.properties.taxonomy_type.enum, ["buyer", "seller"]);
      assert.equal(tool.inputSchema.properties.taxonomy_id.minimum, 1);
      assert.equal(tool.inputSchema.properties.taxonomy_id.maximum, Number.MAX_SAFE_INTEGER);
      assert.equal(tool.inputSchema.properties.supports_variations.type, "boolean");
      assert.equal(tool.inputSchema.properties.supports_attributes.type, "boolean");
      assert.deepEqual(tool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    },
  );
});

test("IDs returned by buyer and seller tree browsing use their matching property routes", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => {
      if (config.url === "/application/buyer-taxonomy/nodes") {
        return successResponse(config, taxonomyTree(101, "Buyer category"));
      }
      if (config.url === "/application/seller-taxonomy/nodes") {
        return successResponse(config, taxonomyTree(202, "Seller category"));
      }
      if (config.url === "/application/buyer-taxonomy/nodes/101/properties") {
        return successResponse(config, { count: 0, results: [] });
      }
      if (config.url === "/application/seller-taxonomy/nodes/202/properties") {
        return successResponse(config, { count: 0, results: [] });
      }
      throw new Error(`Unexpected mocked URL: ${config.url}`);
    }, calls),
    async ({ client }) => {
      for (const [taxonomyType, taxonomyId] of [["buyer", 101], ["seller", 202]]) {
        const nodes = await client.callTool({
          name: "get_taxonomy_nodes",
          arguments: { taxonomy_type: taxonomyType },
        });
        assert.equal(jsonText(nodes).results[0].id, taxonomyId);
      }

      const buyer = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: { taxonomy_type: "buyer", taxonomy_id: 101 },
      });
      const seller = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: {
          taxonomy_type: "seller",
          taxonomy_id: 202,
          supports_variations: false,
          supports_attributes: true,
        },
      });

      assert.equal(jsonText(buyer).taxonomy_type, "buyer");
      assert.equal(jsonText(buyer).taxonomy_id, 101);
      assert.equal(jsonText(seller).taxonomy_type, "seller");
      assert.equal(jsonText(seller).taxonomy_id, 202);
      assert.deepEqual(calls.map((call) => call.url), [
        "/application/buyer-taxonomy/nodes",
        "/application/seller-taxonomy/nodes",
        "/application/buyer-taxonomy/nodes/101/properties",
        "/application/seller-taxonomy/nodes/202/properties",
      ]);
      assert.equal(calls[2].params, undefined, "the buyer route has no seller-only query flags");
      assert.deepEqual(calls[3].params, {
        supports_variations: false,
        supports_attributes: true,
      });
    },
  );
});

test("invalid taxonomy selectors, IDs, seller filters, and buyer-only flag combinations make no requests", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, { count: 0, results: [] }), calls),
    async ({ client }) => {
      const { tools } = await client.listTools();
      assert.ok(
        tools.some((tool) => tool.name === "get_taxonomy_properties"),
        "the property tool must be registered before its arguments are exercised",
      );
      const invalidArguments = [
        { taxonomy_id: 12 },
        { taxonomy_type: "other", taxonomy_id: 12 },
        { taxonomy_type: "buyer", taxonomy_id: 0 },
        { taxonomy_type: "seller", taxonomy_id: -1 },
        { taxonomy_type: "buyer", taxonomy_id: 1.5 },
        { taxonomy_type: "seller", taxonomy_id: Number.MAX_SAFE_INTEGER + 1 },
        { taxonomy_type: "buyer", taxonomy_id: "12" },
        { taxonomy_type: "buyer", taxonomy_id: 12, supports_variations: false },
        { taxonomy_type: "buyer", taxonomy_id: 12, supports_attributes: true },
        { taxonomy_type: "seller", taxonomy_id: 12, supports_variations: null },
        { taxonomy_type: "seller", taxonomy_id: 12, supports_attributes: "true" },
      ];

      for (const args of invalidArguments) {
        const result = await client.callTool({
          name: "get_taxonomy_properties",
          arguments: args,
        });
        assert.equal(result.isError, true, JSON.stringify(args));
        assert.doesNotMatch(result.content[0].text, /Unknown or unsupported Etsy tool/);
      }
      assert.equal(calls.length, 0, "invalid input must be rejected before Etsy is called");
    },
  );
});

test("property output maps scales, allowed values and fixed selected values separately", async () => {
  const upstream = {
    count: 2,
    results: [
      {
        property_id: 21,
        name: "size",
        display_name: "Size",
        is_required: true,
        supports_attributes: true,
        supports_variations: true,
        is_multivalued: false,
        max_values_allowed: 1,
        scales: [{ scale_id: 7, display_name: "US", description: "US sizes" }],
        possible_values: [{ value_id: 31, name: "Small", scale_id: 7, equal_to: [32, 33] }],
        selected_values: [{ value_id: 90, name: "Default", scale_id: null, equal_to: [] }],
        ignored_upstream_field: "must not be passed through",
      },
      {
        property_id: 22,
        name: "material",
        display_name: null,
        is_required: null,
        supports_attributes: false,
        supports_variations: false,
        is_multivalued: null,
        max_values_allowed: null,
        scales: null,
        possible_values: [],
      },
    ],
  };

  await withMcp(
    mockAdapter((config) => successResponse(config, upstream)),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: { taxonomy_type: "buyer", taxonomy_id: 8001 },
      });
      assert.equal(response.isError, undefined, response.content[0].text);
      const output = jsonText(response);
      assert.equal(output.count, 2);
      assert.equal(output.returned, 2);
      assert.deepEqual(output.results, [
        {
          property_id: 21,
          name: "size",
          display_name: "Size",
          is_required: true,
          supports_attributes: true,
          supports_variations: true,
          is_multivalued: false,
          max_values_allowed: 1,
          scales: [{ scale_id: 7, display_name: "US", description: "US sizes" }],
          possible_values: [{ value_id: 31, name: "Small", scale_id: 7, equal_to: [32, 33] }],
          selected_values: [{ value_id: 90, name: "Default", scale_id: null, equal_to: [] }],
        },
        {
          property_id: 22,
          name: "material",
          display_name: null,
          is_required: null,
          supports_attributes: false,
          supports_variations: false,
          is_multivalued: null,
          max_values_allowed: null,
          scales: null,
          possible_values: [],
        },
      ]);
      assert.equal(output.results[0].possible_values[0].value_id, 31);
      assert.equal(output.results[0].selected_values[0].value_id, 90);
      assert.equal(Object.hasOwn(output.results[1], "selected_values"), false);
      assert.equal(Object.hasOwn(output.results[0], "ignored_upstream_field"), false);
      assert.equal(output.truncated, false);
      assert.match(output.untrusted_content_notice, /untrusted/i);
    },
  );
});

test("buyer and seller equal_to associations accept zero per the upstream schema", async () => {
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: 1,
      results: [{
        property_id: 8,
        possible_values: [{ value_id: 9, name: "Value", equal_to: [0, 31] }],
      }],
    }), calls),
    async ({ client }) => {
      for (const [taxonomyType, taxonomyId] of [["buyer", 101], ["seller", 202]]) {
        const response = await client.callTool({
          name: "get_taxonomy_properties",
          arguments: { taxonomy_type: taxonomyType, taxonomy_id: taxonomyId },
        });

        assert.equal(response.isError, undefined, response.content[0].text);
        assert.deepEqual(
          jsonText(response).results[0].possible_values[0].equal_to,
          [0, 31],
        );
      }
      assert.deepEqual(calls.map((call) => call.url), [
        "/application/buyer-taxonomy/nodes/101/properties",
        "/application/seller-taxonomy/nodes/202/properties",
      ]);
    },
  );
});

test("oversized text and property subarrays are shortened with an explicit truncation flag", async () => {
  const upstream = {
    count: 1,
    results: [{
      property_id: 5,
      name: "N".repeat(250),
      scales: Array.from({ length: 11 }, (_, index) => ({
        scale_id: index + 1,
        display_name: "Scale",
        description: "D".repeat(550),
      })),
      possible_values: Array.from({ length: 51 }, (_, index) => ({
        value_id: index + 1,
        name: "V".repeat(250),
        scale_id: 1,
        equal_to: Array.from({ length: 11 }, (__, equalIndex) => equalIndex + 1),
      })),
      selected_values: Array.from({ length: 26 }, (_, index) => ({
        value_id: index + 100,
        name: "Selected",
      })),
    }],
  };

  await withMcp(
    mockAdapter((config) => successResponse(config, upstream)),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: { taxonomy_type: "seller", taxonomy_id: 17 },
      });
      const output = jsonText(response);
      const property = output.results[0];

      assert.equal(property.name.length, 200);
      assert.equal(property.scales.length, 10);
      assert.equal(property.scales[0].description.length, 500);
      assert.equal(property.possible_values.length, 50);
      assert.equal(property.possible_values[0].equal_to.length, 10);
      assert.equal(property.selected_values.length, 25);
      assert.equal(output.count, 1, "count remains the untrimmed upstream count");
      assert.equal(output.returned, 1);
      assert.equal(output.truncated, true);
    },
  );
});

test("large mapped property pages stay within 128 KiB and report dropped rows", async () => {
  const values = (start, length, name) => Array.from({ length }, (_, index) => ({
    value_id: start + index,
    name,
    scale_id: 1,
    equal_to: Array.from({ length: 10 }, (__, equalIndex) => equalIndex + 1),
  }));
  const properties = Array.from({ length: 40 }, (_, index) => ({
    property_id: index + 1,
    name: "P".repeat(200),
    display_name: "Display".repeat(25),
    scales: Array.from({ length: 10 }, (__, scaleIndex) => ({
      scale_id: scaleIndex + 1,
      display_name: "Scale".repeat(30),
      description: "Description".repeat(45),
    })),
    possible_values: values(1000 + index * 50, 50, "Allowed".repeat(28)),
    selected_values: values(5000 + index * 25, 25, "Selected".repeat(25)),
  }));

  await withMcp(
    mockAdapter((config) => successResponse(config, {
      count: properties.length,
      results: properties,
    })),
    async ({ client }) => {
      const response = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: { taxonomy_type: "buyer", taxonomy_id: 41 },
      });
      const raw = response.content[0].text;
      const output = JSON.parse(raw);

      assert.equal(Buffer.byteLength(raw, "utf8") <= 128 * 1024, true);
      assert.equal(output.count, 40);
      assert.ok(output.returned > 0 && output.returned < output.count);
      assert.equal(output.returned, output.results.length);
      assert.equal(output.truncated, true);
    },
  );
});

test("malformed property responses fail instead of claiming an empty category", async () => {
  const responses = [
    { count: 0 },
    { count: 2, results: [{ property_id: 1 }] },
    { count: 1, results: [null] },
  ];
  await withMcp(
    mockAdapter((config) => successResponse(config, responses.shift())),
    async ({ client }) => {
      for (let index = 0; index < 3; index += 1) {
        const response = await client.callTool({
          name: "get_taxonomy_properties",
          arguments: { taxonomy_type: "seller", taxonomy_id: index + 1 },
        });
        assert.equal(response.isError, true);
        assert.match(response.content[0].text, /^Error:/);
        assert.match(response.content[0].text, /taxonomy properties|invalid taxonomy/i);
        assert.doesNotMatch(response.content[0].text, /"results":\[\]/);
      }
    },
  );
});

test("upstream size and credential-bearing failures are sanitized errors", async () => {
  await withMcp(
    mockAdapter((config) => {
      if (config.url.endsWith("/1/properties")) {
        throw new AxiosError(
          "maxContentLength size of 1048576 exceeded",
          AxiosError.ERR_BAD_RESPONSE,
          config,
        );
      }
      throw httpError(config, 500, { error: `unexpected ${syntheticKey}` });
    }),
    async ({ client }) => {
      const oversized = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: { taxonomy_type: "buyer", taxonomy_id: 1 },
      });
      assert.equal(oversized.isError, true);
      assert.match(oversized.content[0].text, /1 MiB upstream response limit/);
      assert.doesNotMatch(oversized.content[0].text, /synthetic|secret/);

      const failed = await client.callTool({
        name: "get_taxonomy_properties",
        arguments: { taxonomy_type: "seller", taxonomy_id: 2 },
      });
      assert.equal(failed.isError, true);
      assert.match(failed.content[0].text, /^Error:/);
      assert.doesNotMatch(failed.content[0].text, /synthetic|secret/);
    },
  );
});
