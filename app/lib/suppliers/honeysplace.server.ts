/**
 * Honey's Place API Integration
 * Base endpoint: https://www.honeysplace.com/ws/
 * Auth: account + password (API token)
 * Formats: XML for API calls, JSON/CSV for data feeds
 */

import type { SupplierCredential } from "@prisma/client";

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Types ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
export interface HoneysPlaceCredentials {
  account: string;
  apiToken: string; // "password" in their API
  feedToken: string; // data feed token
  feedUrl?: string;  // optional: full feed URL pasted from HP portal (overrides constructed URL)
}

export interface HoneysPlaceProduct {
  sku: string;
  upc: string;
  title: string;
  description: string;
  cost: number;
  msrp: number;
  inventoryQty: number;
  category: string;
  manufacturer: string;
  images: string[];
  weight: number;
}

export interface HoneysPlaceOrderItem {
  sku: string;
  qty: number;
}

export interface HoneysPlaceOrderRequest {
  reference: string; // your order number
  shipBy: string; // see Appendix A codes
  date: string; // MM/DD/YY
  items: HoneysPlaceOrderItem[];
  // Shipping address (required by HP API)
  lastName: string;
  firstName: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
  instructions?: string;
}

export interface HoneysPlaceOrderResponse {
  reference: string;
  code: string; // "100" = success, "999" = bad auth, etc.
  message?: string;
}

export interface HoneysPlaceOrderStatus {
  reference: string;
  salesOrder: string;
  orderDate: string;
  shipAgent: string;
  shipService: string;
  freightCost: number;
  trackingNumber: string;
  status: string;
}

export interface HoneysPlaceStockItem {
  sku: string;
  qty: number;
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Credential helpers ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
export function decryptCredentials(encrypted: string | Record<string, unknown>): HoneysPlaceCredentials {
  // Handle both string (from API) and already-parsed object (from Prisma Json field)
  return (typeof encrypted === "string" ? JSON.parse(encrypted) : encrypted) as HoneysPlaceCredentials;
}

export function encryptCredentials(creds: HoneysPlaceCredentials): string {
  // TODO: replace with AES encryption
  return JSON.stringify(creds);
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ XML helpers ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function buildXmlEnvelope(
  account: string,
  password: string,
  innerXml: string
): string {
  return `<?xml version="1.0" encoding="iso-8859-1"?>
<HPEnvelope>
<account>${account}</account>
<password>${password}</password>
${innerXml}
</HPEnvelope>`;
}

function parseXmlResponse(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tagPattern = /<(\w+)>([^<]*)<\/\1>/g;
  let match;
  while ((match = tagPattern.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ API Calls ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
const BASE_URL = "https://www.honeysplace.com/ws/";

/**
 * Check stock for a single SKU
 */
export async function checkStock(
  credentials: HoneysPlaceCredentials,
  sku: string
): Promise<HoneysPlaceStockItem> {
  const xml = buildXmlEnvelope(
    credentials.account,
    credentials.apiToken,
    `<stockcheck>
  <sku>${sku}</sku>
</stockcheck>`
  );

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });

  if (!response.ok) {
    throw new Error(`Honey's Place stock check HTTP error: ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parseXmlResponse(responseText);

  return {
    sku: parsed.sku || sku,
    qty: parseInt(parsed.qty || "0", 10),
  };
}

/**
 * Check stock for multiple SKUs (batches requests)
 */
export async function checkStockBatch(
  credentials: HoneysPlaceCredentials,
  skus: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  // Honey's Place API checks one item at a time
  const promises = skus.map((sku) =>
    checkStock(credentials, sku).then((item) => {
      results.set(item.sku, item.qty);
    })
  );

  // Rate limit: process in batches of 5 concurrent requests
  const batchSize = 5;
  for (let i = 0; i < promises.length; i += batchSize) {
    await Promise.all(promises.slice(i, i + batchSize));
    if (i + batchSize < promises.length) {
      await new Promise((r) => setTimeout(r, 200)); // 200ms between batches
    }
  }

  return results;
}

/**
 * Submit an order to Honey's Place
 */
export async function submitOrder(
  credentials: HoneysPlaceCredentials,
  order: HoneysPlaceOrderRequest
): Promise<HoneysPlaceOrderResponse> {
  const itemsXml = order.items
    .map((item) => `<item>\n<sku>${item.sku}</sku>\n<qty>${item.qty}</qty>\n</item>`)
    .join("\n");

  const xml = buildXmlEnvelope(
    credentials.account,
    credentials.apiToken,
    `<order>
  <reference>${order.reference}</reference>
  <shipby>${order.shipBy}</shipby>
  <date>${order.date}</date>
  <items>
    ${itemsXml}
  </items>
  <last>${order.lastName || ""}</last>
  <first>${order.firstName || ""}</first>
  <address1>${order.address1 || ""}</address1>
  <address2>${order.address2 || ""}</address2>
  <city>${order.city || ""}</city>
  <state>${order.state || ""}</state>
  <zip>${order.zip || ""}</zip>
  <country>${order.country || "US"}</country>
  <phone>${order.phone || ""}</phone>
  <emailaddress>${order.email || ""}</emailaddress>
  <instructions>${order.instructions || ""}</instructions>
</order>`
  );

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });

  if (!response.ok) {
    throw new Error(`Honey's Place order submit HTTP error: ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parseXmlResponse(responseText);

  const codeDescriptions: Record<string, string> = {
    "100": "Order accepted for processing.",
    "999": "Invalid username/password.",
    "800": "First name is required.",
    "804": "State is required.",
    "700": "Reference number already used.",
    "600": "Invalid shipping code.",
    "500": "One or more submitted products have been discontinued.",
    "501": "One or more submitted products do not exist.",
    "400": "Duplicate product within same order.",
    "300": "Checking status on order not yet submitted.",
    "0": "Unknown error. Contact support.",
  };

  return {
    reference: parsed.reference || order.reference,
    code: parsed.code || "0",
    message: codeDescriptions[parsed.code] || "Unknown response",
  };
}

/**
 * Check order status
 */
export async function checkOrderStatus(
  credentials: HoneysPlaceCredentials,
  reference: string
): Promise<HoneysPlaceOrderStatus> {
  const xml = buildXmlEnvelope(
    credentials.account,
    credentials.apiToken,
    `<orderstatus>${reference}</orderstatus>`
  );

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });

  if (!response.ok) {
    throw new Error(`Honey's Place order status HTTP error: ${response.status}`);
  }

  const responseText = await response.text();
  const parsed = parseXmlResponse(responseText);

  return {
    reference: parsed.reference || reference,
    salesOrder: parsed.salesorder || "",
    orderDate: parsed.orderdate || "",
    shipAgent: parsed.shipagent || "",
    shipService: parsed.shipservice || "",
    freightCost: parseFloat(parsed.freightcost || "0"),
    trackingNumber: parsed.trackingnumber1 || "",
    status: parsed.status || "Unknown",
  };
}

/**
 * Build the data feed URL from credentials
 * HP feed format: https://www.honeysplace.com/df/FEEDTOKEN/json
 * Note: The older DataFeed/json?account=X&token=Y format returns 404 as of 2026.
 */
export function buildFeedUrl(credentials: HoneysPlaceCredentials): string {
  // Use the full URL if pasted directly from HP portal (My Account > Data Integration > Data Feeds)
  if (credentials.feedUrl && credentials.feedUrl.startsWith("http")) {
    return credentials.feedUrl;
  }
  const token = credentials.feedToken || credentials.apiToken;
  if (!token) throw new Error("Honey's Place: no feed token or API token in credentials");
  // Use the df/TOKEN/json format (the DataFeed/json?account=X&token=Y format is deprecated/404)
  return `https://www.honeysplace.com/df/${encodeURIComponent(token)}/json`;
}

/**
 * Fetch product catalog from Honey's Place data feed (JSON format).
 * Handles the actual HP feed field names (ItemName, YourCost, QtyAvailable, ImageURL)
 * as well as common fallback names for robustness.
 */
export async function fetchProductFeed(
  feedUrl: string
): Promise<HoneysPlaceProduct[]> {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`Honey's Place feed HTTP error: ${response.status}`);
  }

  const data = (await response.json()) as any[];

  return data.map((item: any) => {
    // Collect images: primary + alternates
    // HP feed field names vary by customer tier and feed version
    const primaryImage =
      item.ImageURL || item.imageURL || item.imageUrl || item.image_url ||
      item["Image URL"] || item["Image Url"] || item["image url"] ||
      item.PrimaryImage || item.primaryImage || item.MainImage || item.main_image ||
      item.ProductImage || item.product_image ||
      item.Thumbnail || item.thumbnail || item.ThumbnailURL || item.thumbnailUrl ||
      item.image || item.Image ||
      item.LargeImage || item.large_image || item.FullImage || item.full_image ||
      "";

    const altImages: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const alt =
        item[`ImageURL${i}`] || item[`imageURL${i}`] || item[`imageUrl${i}`] ||
        item[`AltImage${i}`] || item[`altImage${i}`] || item[`alt_image_${i}`] ||
        item[`AlternateImage${i}`] || item[`alternate_image_${i}`] ||
        item[`image_url_${i}`] ||
        "";
      if (alt) altImages.push(String(alt));
    }
    if (item.additional_images) {
      if (Array.isArray(item.additional_images)) {
        altImages.push(...item.additional_images.filter(Boolean).map(String));
      } else if (item.additional_images) {
        altImages.push(String(item.additional_images));
      }
    }
    if (item.AdditionalImages) {
      const addl = Array.isArray(item.AdditionalImages) ? item.AdditionalImages : [item.AdditionalImages];
      altImages.push(...addl.filter(Boolean).map(String));
    }

    return {
      sku: String(
        item.ItemNumber ||
        item.sku ||
        item.SKU ||
        item["Item Number"] ||
        item.itemNumber ||
        ""
      ),
      upc: String(
        item.UPCCode ||
        item.upc ||
        item.UPC ||
        item["UPC Code"] ||
        item.upcCode ||
        ""
      ),
      title: String(
        item.ItemName ||
        item.ProductName ||
        item.title ||
        item.Title ||
        item["Product Name"] ||
        item.name ||
        ""
      ).trim(),
      description: String(
        item.Description ||
        item.description ||
        item.LongDescription ||
        item.ShortDescription ||
        ""
      ),
      cost: parseFloat(
        String(
          item.YourCost ??
          item.WholesalePrice ??
          item.cost ??
          item.Cost ??
          item["Wholesale Price"] ??
          "0"
        )
      ),
      msrp: parseFloat(
        String(
          item.MSRP ??
          item.RetailPrice ??
          item.retail_price ??
          item["Retail Price"] ??
          item.msrp ??
          "0"
        )
      ),
      inventoryQty: parseInt(
        String(
          item.QtyAvailable ??
          item.QuantityAvailable ??
          item.quantity ??
          item.Quantity ??
          item.qty ??
          item.Stock ??
          "0"
        ),
        10
      ),
      category: String(
        item.Category ||
        item.category ||
        item.ProductType ||
        item.Type ||
        ""
      ),
      manufacturer: String(
        item.Brand ||
        item.Manufacturer ||
        item.manufacturer ||
        item.brand ||
        item.Vendor ||
        ""
      ),
      images: [primaryImage, ...altImages]
        .filter((url): url is string => typeof url === "string" && url.startsWith("http")),
      weight: parseFloat(String(item.Weight ?? item.weight ?? "0")),
    };
  });
}

/**
 * Validate credentials by attempting a stock check on a known item
 */
export async function validateCredentials(
  credentials: HoneysPlaceCredentials
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Attempt a stock check with dummy SKU - if we get 999 it's bad auth
    const xml = buildXmlEnvelope(
      credentials.account,
      credentials.apiToken,
      `<stockcheck><sku>TEST-VALIDATION</sku></stockcheck>`
    );
    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xml,
    });
    const text = await response.text();
    if (text.includes("<code>999</code>")) {
      return { valid: false, error: "Invalid account or API token." };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Shipping Codes (Appendix A) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
export const SHIPPING_CODES = [
  { code: "F001", label: "FedEx First Overnight" },
  { code: "F002", label: "FedEx Priority Overnight" },
  { code: "F003", label: "FedEx Standard Overnight" },
  { code: "F004", label: "FedEx 2 Day Air" },
  { code: "F005", label: "FedEx Express Saver" },
  { code: "F006", label: "FedEx Ground (USA/Canada/Mexico)" },
  { code: "F007", label: "FedEx Ground Home Delivery" },
  { code: "F008", label: "FedEx International Priority" },
  { code: "F009", label: "FedEx International Economy" },
  { code: "F010", label: "FedEx SmartPost" },
  { code: "P001", label: "USPS Express Mail (Overnight)" },
  { code: "P002", label: "USPS Priority Mail" },
  { code: "P003", label: "USPS First Class (< 13oz)" },
  { code: "P005", label: "USPS International Express Mail" },
  { code: "P006", label: "USPS International Priority Mail" },
  { code: "P007", label: "USPS International First Class" },
  { code: "P008", label: "USPS Priority Flat Rate" },
  { code: "U001", label: "UPS Next Day Air" },
  { code: "U002", label: "UPS 2nd Day Air" },
  { code: "U003", label: "UPS 3 Day Select" },
  { code: "U004", label: "UPS Ground" },
  { code: "U005", label: "UPS Standard (Canada)" },
  { code: "PICKUP", label: "Customer Pickup" },
  { code: "RTSHOP", label: "Best Rate (Cheapest)" },
];
