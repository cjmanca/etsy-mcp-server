# Usage Examples

Here are some example queries you can use with the Etsy MCP server:

## Searching for Products

### Basic Search
```
Search Etsy for handmade leather wallets
```

### Search with Price Filter
```
Find vintage typewriters on Etsy under $200
```

### Search with Sorting
```
Search for wedding decorations on Etsy, sorted by price from lowest to highest
```

## Getting Product Details

```
Get full details including images for Etsy listing 1234567890
```

```
Show me all information about listing ID 9876543210 including shop details and inventory
```

## Shop Information

### Find a Shop
```
Get information about the Etsy shop "VintageFindsShop"
```

### Browse Shop Listings
```
Show me all products from shop ID 12345678
```

### Search for Shops
```
Find Etsy shops that sell pottery
```

### Shop Reviews
```
Get recent reviews for shop ID 12345678
```

```
Show me reviews from the last 30 days for shop 9876543
```

## Trending Products

```
What are the trending items on Etsy right now?
```

```
Show me 50 trending products on Etsy
```

## Advanced Queries

### Multiple Filters
```
Find handmade ceramic mugs on Etsy priced between $15 and $40, sorted by most recent
```

### Research Product Category
```
Search for eco-friendly phone cases on Etsy and show me the top 10 results
```

### Compare Shops
```
Get information about these three Etsy shops: ShopA, ShopB, and ShopC
```

### Product Analysis
```
Show me trending home decor items and get detailed information on the top 5 listings
```

## Pagination Examples

### Getting More Results
```
Search for vintage jewelry on Etsy (first 25 results)
```
Then:
```
Get the next 25 results (offset 25)
```

### Large Dataset
```
Show me all listings from shop 12345678, 50 at a time
```

## Using Tool Parameters Directly

When the AI uses the tools, here are example parameter combinations:

### search_listings
```json
{
  "keywords": "handmade jewelry",
  "limit": 25,
  "min_price": 10,
  "max_price": 100,
  "sort_on": "price",
  "sort_order": "asc"
}
```

### get_listing_details
```json
{
  "listing_id": 1234567890,
  "includes": ["Shop", "Images", "Inventory"]
}
```

### get_shop_by_name
```json
{
  "shop_name": "ArtisanCrafts"
}
```

### get_shop_listings
```json
{
  "shop_id": 12345678,
  "limit": 50,
  "offset": 0,
  "sort_on": "created",
  "sort_order": "desc"
}
```

### search_shops
```json
{
  "shop_name": "pottery",
  "limit": 10
}
```

### get_trending_listings
```json
{
  "limit": 20,
  "offset": 0
}
```

### get_shop_reviews
```json
{
  "shop_id": 12345678,
  "limit": 25
}
```

## Use Cases

### Market Research
"I want to research the handmade soap market on Etsy. Search for handmade soap, show me trending items, and get details on the top-rated shops."

### Gift Shopping
"I'm looking for a birthday gift for someone who loves astronomy. Search Etsy for astronomy-themed items under $50."

### Shop Analysis
"Analyze the shop 'VintageCollectibles' - show me their active listings, recent reviews, and shop information."

### Price Comparison
"Find similar leather laptop bags on Etsy and compare their prices and ratings."

### Trend Identification
"What are the trending home office items on Etsy? Get details on the top 10."
