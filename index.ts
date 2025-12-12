#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

// Etsy API configuration
const ETSY_API_BASE = "https://openapi.etsy.com/v3";
const API_KEY = process.env.ETSY_API_KEY;

if (!API_KEY) {
  console.error("Error: ETSY_API_KEY environment variable is required");
  process.exit(1);
}

// Create axios instance with default config
const etsyClient: AxiosInstance = axios.create({
  baseURL: ETSY_API_BASE,
  headers: {
    "x-api-key": API_KEY,
  },
});

// Define available tools
const TOOLS: Tool[] = [
  {
    name: "search_listings",
    description:
      "Search for active listings on Etsy. Returns product listings matching the search criteria.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: {
          type: "string",
          description: "Search keywords to find listings",
        },
        limit: {
          type: "number",
          description: "Number of results to return (1-100, default: 25)",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "number",
          description: "Pagination offset (default: 0)",
          minimum: 0,
        },
        min_price: {
          type: "number",
          description: "Minimum price in USD",
        },
        max_price: {
          type: "number",
          description: "Maximum price in USD",
        },
        sort_on: {
          type: "string",
          description: "Sort results by",
          enum: ["created", "price", "updated", "score"],
        },
        sort_order: {
          type: "string",
          description: "Sort order",
          enum: ["asc", "desc", "ascending", "descending"],
        },
      },
      required: ["keywords"],
    },
  },
  {
    name: "get_listing_details",
    description:
      "Get detailed information about a specific Etsy listing by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: {
          type: "number",
          description: "The numeric ID of the listing",
        },
        includes: {
          type: "array",
          items: {
            type: "string",
            enum: ["Shop", "Images", "User", "Videos", "Inventory"],
          },
          description:
            "Additional data to include (Shop, Images, User, Videos, Inventory)",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "get_shop_by_name",
    description: "Get information about an Etsy shop by its shop name.",
    inputSchema: {
      type: "object",
      properties: {
        shop_name: {
          type: "string",
          description: "The name/slug of the shop",
        },
      },
      required: ["shop_name"],
    },
  },
  {
    name: "get_shop_listings",
    description: "Get all active listings from a specific Etsy shop.",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: {
          type: "number",
          description: "The numeric ID of the shop",
        },
        limit: {
          type: "number",
          description: "Number of results to return (1-100, default: 25)",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "number",
          description: "Pagination offset (default: 0)",
          minimum: 0,
        },
        sort_on: {
          type: "string",
          description: "Sort results by",
          enum: ["created", "price", "updated", "score"],
        },
        sort_order: {
          type: "string",
          description: "Sort order",
          enum: ["asc", "desc", "ascending", "descending"],
        },
      },
      required: ["shop_id"],
    },
  },
  {
    name: "search_shops",
    description: "Search for Etsy shops by name or keywords.",
    inputSchema: {
      type: "object",
      properties: {
        shop_name: {
          type: "string",
          description: "Shop name to search for",
        },
        limit: {
          type: "number",
          description: "Number of results to return (1-100, default: 25)",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "number",
          description: "Pagination offset (default: 0)",
          minimum: 0,
        },
      },
      required: ["shop_name"],
    },
  },
  {
    name: "get_trending_listings",
    description:
      "Get trending listings on Etsy. Returns currently popular items.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of results to return (1-100, default: 25)",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "number",
          description: "Pagination offset (default: 0)",
          minimum: 0,
        },
      },
    },
  },
  {
    name: "get_shop_reviews",
    description: "Get reviews for a specific Etsy shop.",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: {
          type: "number",
          description: "The numeric ID of the shop",
        },
        limit: {
          type: "number",
          description: "Number of results to return (1-100, default: 25)",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "number",
          description: "Pagination offset (default: 0)",
          minimum: 0,
        },
        min_created: {
          type: "number",
          description: "Unix timestamp for minimum review creation date",
        },
        max_created: {
          type: "number",
          description: "Unix timestamp for maximum review creation date",
        },
      },
      required: ["shop_id"],
    },
  },
];

// Tool handlers
async function searchListings(args: any) {
  const params: any = {
    keywords: args.keywords,
    limit: args.limit || 25,
    offset: args.offset || 0,
  };

  if (args.min_price) params.min_price = args.min_price;
  if (args.max_price) params.max_price = args.max_price;
  if (args.sort_on) params.sort_on = args.sort_on;
  if (args.sort_order) params.sort_order = args.sort_order;

  const response = await etsyClient.get("/application/listings/active", {
    params,
  });

  return {
    count: response.data.count,
    results: response.data.results.map((listing: any) => ({
      listing_id: listing.listing_id,
      title: listing.title,
      description: listing.description,
      price: listing.price?.amount
        ? `${listing.price.amount / listing.price.divisor} ${listing.price.currency_code}`
        : "N/A",
      url: listing.url,
      shop_id: listing.shop_id,
      quantity: listing.quantity,
      state: listing.state,
      created: listing.created_timestamp,
      updated: listing.updated_timestamp,
      tags: listing.tags,
    })),
  };
}

async function getListingDetails(args: any) {
  const includes = args.includes?.join(",") || "";
  const params = includes ? { includes } : {};

  const response = await etsyClient.get(
    `/application/listings/${args.listing_id}`,
    { params }
  );

  const listing = response.data;
  return {
    listing_id: listing.listing_id,
    title: listing.title,
    description: listing.description,
    price: listing.price?.amount
      ? `${listing.price.amount / listing.price.divisor} ${listing.price.currency_code}`
      : "N/A",
    url: listing.url,
    shop_id: listing.shop_id,
    quantity: listing.quantity,
    state: listing.state,
    created: listing.created_timestamp,
    updated: listing.updated_timestamp,
    tags: listing.tags,
    materials: listing.materials,
    shipping_profile_id: listing.shipping_profile_id,
    shop: listing.Shop,
    images: listing.Images?.map((img: any) => ({
      url_570xN: img.url_570xN,
      url_fullxfull: img.url_fullxfull,
      listing_image_id: img.listing_image_id,
    })),
    videos: listing.Videos,
    inventory: listing.Inventory,
  };
}

async function getShopByName(args: any) {
  const response = await etsyClient.get(
    `/application/shops/${args.shop_name}`
  );

  const shop = response.data;
  return {
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    title: shop.title,
    announcement: shop.announcement,
    currency_code: shop.currency_code,
    is_vacation: shop.is_vacation,
    vacation_message: shop.vacation_message,
    sale_message: shop.sale_message,
    digital_sale_message: shop.digital_sale_message,
    create_date: shop.create_date,
    created_timestamp: shop.created_timestamp,
    listing_active_count: shop.listing_active_count,
    url: shop.url,
  };
}

async function getShopListings(args: any) {
  const params: any = {
    limit: args.limit || 25,
    offset: args.offset || 0,
    state: "active",
  };

  if (args.sort_on) params.sort_on = args.sort_on;
  if (args.sort_order) params.sort_order = args.sort_order;

  const response = await etsyClient.get(
    `/application/shops/${args.shop_id}/listings`,
    { params }
  );

  return {
    count: response.data.count,
    results: response.data.results.map((listing: any) => ({
      listing_id: listing.listing_id,
      title: listing.title,
      description: listing.description,
      price: listing.price?.amount
        ? `${listing.price.amount / listing.price.divisor} ${listing.price.currency_code}`
        : "N/A",
      url: listing.url,
      quantity: listing.quantity,
      state: listing.state,
      tags: listing.tags,
    })),
  };
}

async function searchShops(args: any) {
  const params: any = {
    shop_name: args.shop_name,
    limit: args.limit || 25,
    offset: args.offset || 0,
  };

  const response = await etsyClient.get("/application/shops", { params });

  return {
    count: response.data.count,
    results: response.data.results.map((shop: any) => ({
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      title: shop.title,
      url: shop.url,
      listing_active_count: shop.listing_active_count,
      currency_code: shop.currency_code,
      is_vacation: shop.is_vacation,
    })),
  };
}

async function getTrendingListings(args: any) {
  const params: any = {
    limit: args.limit || 25,
    offset: args.offset || 0,
  };

  const response = await etsyClient.get("/application/listings/trending", {
    params,
  });

  return {
    count: response.data.count,
    results: response.data.results.map((listing: any) => ({
      listing_id: listing.listing_id,
      title: listing.title,
      price: listing.price?.amount
        ? `${listing.price.amount / listing.price.divisor} ${listing.price.currency_code}`
        : "N/A",
      url: listing.url,
      shop_id: listing.shop_id,
      tags: listing.tags,
    })),
  };
}

async function getShopReviews(args: any) {
  const params: any = {
    limit: args.limit || 25,
    offset: args.offset || 0,
  };

  if (args.min_created) params.min_created = args.min_created;
  if (args.max_created) params.max_created = args.max_created;

  const response = await etsyClient.get(
    `/application/shops/${args.shop_id}/reviews`,
    { params }
  );

  return {
    count: response.data.count,
    results: response.data.results.map((review: any) => ({
      shop_id: review.shop_id,
      listing_id: review.listing_id,
      rating: review.rating,
      review: review.review,
      created_timestamp: review.created_timestamp,
      updated_timestamp: review.updated_timestamp,
    })),
  };
}

// Create and configure MCP server
const server = new Server(
  {
    name: "etsy-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "search_listings":
        return { content: [{ type: "text", text: JSON.stringify(await searchListings(args), null, 2) }] };
      case "get_listing_details":
        return { content: [{ type: "text", text: JSON.stringify(await getListingDetails(args), null, 2) }] };
      case "get_shop_by_name":
        return { content: [{ type: "text", text: JSON.stringify(await getShopByName(args), null, 2) }] };
      case "get_shop_listings":
        return { content: [{ type: "text", text: JSON.stringify(await getShopListings(args), null, 2) }] };
      case "search_shops":
        return { content: [{ type: "text", text: JSON.stringify(await searchShops(args), null, 2) }] };
      case "get_trending_listings":
        return { content: [{ type: "text", text: JSON.stringify(await getTrendingListings(args), null, 2) }] };
      case "get_shop_reviews":
        return { content: [{ type: "text", text: JSON.stringify(await getShopReviews(args), null, 2) }] };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = error.response?.data?.error || error.message;
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Etsy MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
