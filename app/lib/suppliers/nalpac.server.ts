/**
 * Nalpac API Integration
 * API docs: https://api2.nalpac.com/Help
 * Format: REST, JSON
 * Auth: username + password (HTTP Basic Auth)
 */

// âââ Types âââ

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

// âââ Auth helper âââ

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

// âââ Product Catalog âââ

/**
 * Fetch Nalpac product catalog (paginated)
 * Endpoint varies by implementation â check https://api2.nalpac.com/Help
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

  // Try multiple endpoints — Nalpac API path varies by account configuration
  const endpoints = [
    `${baseUrl}/api/products?page=${page}&pageSize=${pageSize}`,
    `${baseUrl}/api/items?page=${page}&pageSize=${pageSize}`,
    `${baseUrl}/api/Products?page=${page}&pageSize=${pageSize}`,
  ];

  let response: Response | null = null;
  let lastStatus = 0;
  for (const url of endpoints) {
    const r = await fetch(url, { headers });
    if (r.status === 401) throw new Error("Nalpac: Invalid credentials");
    if (r.ok) { response = r; break; }
    lastStatus = r.status;
  }
  if (!response) {
    throw new Error(`Nalpac product fetch HTTP ${lastStatus} (tried /api/products, /api/items, /api/Products)`);
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

// âââ Inventory Check âââ

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

// âââ Place Order âââ

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

// âââ Order Status âââ

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

// âââ Validate Credentials âââ

export async function validateCredentials(
  credentials: NalpacCredentials
): Promise<{ valid: boolean; error?: string }> {
  try {
    const baseUrl = getBaseUrl(credentials);
    const response = await fetch(`${baseUrl}/api/products?pageSize=1`, {
      headers: {
        Authorization: getAuthHeader(credentials),
        Accept: "application/json",
      },
    });
    if (response.status === 401) {
      return { valid: false, error: "Invalid username or password." };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

// âââ Shipping Methods âââ
// These are common Nalpac shipping codes â verify with actual API docs

export const SHIPPING_METHODS = [
  { code: "GROUND", label: "UPS Ground" },
  { code: "2DAY", label: "UPS 2nd Day Air" },
  { code: "OVERNIGHT", label: "UPS Next Day Air" },
  { code: "USPS_PRIORITY", label: "USPS Priority Mail" },
  { code: "USPS_GROUND", label: "USPS Ground Advantage" },
  { code: "FEDEX_GROUND", label: "FedEx Ground" },
  { code: "BESTWAY", label: "Best Way (Cheapest)" },
];
