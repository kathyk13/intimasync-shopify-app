/**
 * Nalpac API Integration
 * API docs: https://api2.nalpac.com/Help
 * Format: REST, JSON
 * Auth: username + password (HTTP Basic Auth)
 */

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Types Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export interface NalpacCredentials {
  username: string;
  password: string;
  baseUrl?: string; // defaults to https://api2.nalpac.com
}

export interface NalpacProduct {
  sku: string;          // Nalpac item number
  upc: string;
  title: string;
  description: string;
  cost: number;         // wholesale price
  msrp: number;
  inventoryQty: number;
  category: string;
  manufacturer: string;
  images: string[];
  weight?: number;
  dimensions?: {
    height?: number;
    width?: number;
    depth?: number;
  };
}

export interface NalpacOrderItem {
  itemNumber: string;
  quantity: number;
}

export interface NalpacOrderRequest {
  poNumber: string;
  shippingMethod: string;
  shipToName: string;
  shipToAddress1: string;
  shipToAddress2?: string;
  shipToCity: string;
  shipToState: string;
  shipToZip: string;
  shipToCountry: string;
  shipToPhone: string;
  items: NalpacOrderItem[];
  specialInstructions?: string;
}

export interface NalpacOrderResponse {
  success: boolean;
  orderId?: string;
  message?: string;
  error?: string;
}

export interface NalpacStockItem {
  itemNumber: string;
  quantityAvailable: number;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Auth helper Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

const DEFAULT_BASE_URL = "https://api2.nalpac.com";

function getAuthHeader(credentials: NalpacCredentials): string {
  const encoded = Buffer.from(
    `${credentials.username}:${credentials.password}`
  ).toString("base64");
  return `Basic ${encoded}`;
}

function getBaseUrl(credentials: NalpacCredentials): string {
  return credentials.baseUrl || DEFAULT_BASE_URL;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Product Catalog Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

/**
 * Fetch Nalpac product catalog (paginated)
 * Endpoint varies by implementation Ã¢ÂÂ check https://api2.nalpac.com/Help
 */
export async function fetchProducts(
  credentials: NalpacCredentials,
  page = 1,
  pageSize = 500
): Promise<NalpacProduct[]> {
  const baseUrl = getBaseUrl(credentials);
  const headers = {
    Authorization: getAuthHeader(credentials),
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Try multiple endpoints â Nalpac API path varies by account configuration
  const endpoints = [
    `${baseUrl}/api/product?pageNumber=${page}&pageSize=${pageSize}`,
    `${baseUrl}/api/productV2?pageNumber=${page}&pageSize=${pageSize}`,
    `${baseUrl}/api/products?pageNumber=${page}&pageSize=${pageSize}`,
  ];

  let response: Response | null = null;
  let lastStatus = 0;
  let lastUrl = "";
  console.log(`[nalpac] fetchProducts: trying ${endpoints.length} endpoints (page=${page})`);
  for (const url of endpoints) {
    let r: Response;
    try {
      r = await fetch(url, { headers });
    } catch (netErr) {
      throw new Error(`Nalpac: network error connecting to ${url}: ${netErr}`);
    }
    if (r.status === 401 || r.status === 403) {
      throw new Error(
        `Nalpac authentication failed (HTTP ${r.status}). ` +
        `Check your username and password in Settings.`
      );
    }
    if (r.ok) {
      console.log(`[nalpac] fetchProducts: endpoint OK — ${url}`);
      response = r;
      break;
    }
    console.log(`[nalpac] fetchProducts: endpoint ${url} returned HTTP ${r.status}`);
    lastStatus = r.status;
    lastUrl = url;
  }
  if (!response) {
    if (lastStatus === 404) {
      throw new Error(
        `Nalpac: no working product endpoint found (all returned 404). ` +
        `The API path may have changed — contact Nalpac support for the correct endpoint.`
      );
    }
    if (lastStatus >= 500) {
      throw new Error(`Nalpac server error (HTTP ${lastStatus}). The Nalpac API may be temporarily down.`);
    }
    throw new Error(`Nalpac product fetch failed (HTTP ${lastStatus} from ${lastUrl}).`);
  }

  const data = await response.json() as any;
  const items = Array.isArray(data) ? data : data.items || data.products || data.data || [];

  return items.map((item: any) => mapNalpacProduct(item));
}

function mapNalpacProduct(item: any): NalpacProduct {
  return {
    sku: String(item.itemNumber || item.sku || item.SKU || item.ItemNumber || ""),
    upc: String(item.upc || item.UPC || item.barcode || ""),
    title: String(item.description || item.title || item.name || item.productName || ""),
    description: String(item.longDescription || item.description2 || item.details || ""),
    cost: parseFloat(String(item.price || item.wholesalePrice || item.cost || "0")),
    msrp: parseFloat(String(item.retailPrice || item.msrp || item.suggestedRetail || "0")),
    inventoryQty: parseInt(String(item.quantityAvailable || item.qty || item.inventory || "0"), 10),
    category: String(item.category || item.productCategory || ""),
    manufacturer: String(item.manufacturer || item.brand || item.vendorName || ""),
    images: [
      item.imageUrl || item.image || item.primaryImage || "",
      ...(item.additionalImages ? (Array.isArray(item.additionalImages) ? item.additionalImages : [item.additionalImages]) : []),
    ].filter(Boolean),
    weight: item.weight ? parseFloat(String(item.weight)) : undefined,
    dimensions: {
      height: item.height ? parseFloat(String(item.height)) : undefined,
      width: item.width ? parseFloat(String(item.width)) : undefined,
      depth: item.depth || item.length ? parseFloat(String(item.depth || item.length)) : undefined,
    },
  };
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Inventory Check Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

/**
 * Check inventory for specific SKUs
 */
export async function checkInventory(
  credentials: NalpacCredentials,
  skus: string[]
): Promise<Map<string, number>> {
  const baseUrl = getBaseUrl(credentials);
  const results = new Map<string, number>();

  // Try batch endpoint first
  try {
    const url = `${baseUrl}/api/inventory`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(credentials),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ itemNumbers: skus }),
    });

    if (response.ok) {
      const data = await response.json() as any[];
      data.forEach((item: any) => {
        const sku = String(item.itemNumber || item.sku || "");
        const qty = parseInt(String(item.quantityAvailable || item.qty || "0"), 10);
        if (sku) results.set(sku, qty);
      });
      return results;
    }
  } catch {
    // Fall through to individual checks
  }

  // Fall back to individual checks
  for (const sku of skus) {
    const url = `${baseUrl}/api/inventory/${encodeURIComponent(sku)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: getAuthHeader(credentials),
        Accept: "application/json",
      },
    });
    if (response.ok) {
      const data = await response.json() as any;
      const qty = parseInt(String(data.quantityAvailable || data.qty || "0"), 10);
      results.set(sku, qty);
    } else {
      results.set(sku, 0);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return results;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Place Order Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function placeOrder(
  credentials: NalpacCredentials,
  order: NalpacOrderRequest
): Promise<NalpacOrderResponse> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/orders`;

  const payload = {
    poNumber: order.poNumber,
    shippingMethod: order.shippingMethod,
    shipTo: {
      name: order.shipToName,
      address1: order.shipToAddress1,
      address2: order.shipToAddress2 || "",
      city: order.shipToCity,
      state: order.shipToState,
      zip: order.shipToZip,
      country: order.shipToCountry,
      phone: order.shipToPhone,
    },
    items: order.items.map((item) => ({
      itemNumber: item.itemNumber,
      quantity: item.quantity,
    })),
    specialInstructions: order.specialInstructions || "",
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(credentials),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    return { success: false, error: errorText };
  }

  const data = await response.json() as any;
  return {
    success: true,
    orderId: String(data.orderId || data.orderNumber || data.id || ""),
    message: data.message || "Order submitted successfully",
  };
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Order Status Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function getOrderStatus(
  credentials: NalpacCredentials,
  orderId: string
): Promise<{
  status: string;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
}> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/orders/${encodeURIComponent(orderId)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(credentials),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Nalpac order status HTTP ${response.status}`);
  }

  const data = await response.json() as any;
  return {
    status: data.status || data.orderStatus || "unknown",
    trackingNumber: data.trackingNumber || data.tracking || undefined,
    carrier: data.carrier || data.shippingCarrier || undefined,
    shippedAt: data.shipDate || data.shippedDate || undefined,
  };
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Validate Credentials Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function validateCredentials(
  credentials: NalpacCredentials
): Promise<{ valid: boolean; error?: string }> {
  // Reuse fetchProducts so Test Connection exercises the exact same auth
  // path and endpoint discovery that catalog sync will use.
  console.log(`[nalpac] validateCredentials: testing with fetchProducts (page=1, size=1)`);
  try {
    await fetchProducts(credentials, 1, 1);
    console.log(`[nalpac] validateCredentials: success`);
    return { valid: true };
  } catch (error) {
    const msg = String(error);
    console.log(`[nalpac] validateCredentials: failed — ${msg}`);
    return { valid: false, error: msg };
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Shipping Methods Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// These are common Nalpac shipping codes Ã¢ÂÂ verify with actual API docs

export const SHIPPING_METHODS = [
  { code: "GROUND", label: "UPS Ground" },
  { code: "2DAY", label: "UPS 2nd Day Air" },
  { code: "OVERNIGHT", label: "UPS Next Day Air" },
  { code: "USPS_PRIORITY", label: "USPS Priority Mail" },
  { code: "USPS_GROUND", label: "USPS Ground Advantage" },
  { code: "FEDEX_GROUND", label: "FedEx Ground" },
  { code: "BESTWAY", label: "Best Way (Cheapest)" },
];
