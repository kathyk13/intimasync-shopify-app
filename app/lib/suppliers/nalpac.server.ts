/**
 * Nalpac API Integration
 * Official docs: https://www.nalpac.com/pages/api-documentation (login required)
 * Base URL: https://api2.nalpac.com
 * Format: REST + JSON
 * Auth: HTTP Basic with CustomerId:ApiPassword
 *
 * LocationId parameter: 15 = Nalpac, 25 = Entrenue (omitting defaults to 15)
 */

// --- Types ---

export interface NalpacCredentials {
  username: string;  // Nalpac Customer ID (numeric, e.g. "142959")
  password: string;  // API password provided by Nalpac
  baseUrl?: string;  // defaults to https://api2.nalpac.com
  includeEntrenue?: boolean; // if true, also pulls LocationId=25 catalog
}

export interface NalpacProduct {
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
  weight?: number;
  dimensions?: {
    height?: number;
    width?: number;
    depth?: number;
  };
  locationId?: number; // 15 = Nalpac, 25 = Entrenue
}

export interface NalpacOrderItem {
  itemNumber: string;
  quantity: number;
}

export interface NalpacOrderRequest {
  poNumber: string;
  shippingOptionId: number;      // numeric carrier ID from /api/carrier
  shipToName: string;
  shipToAddress1: string;
  shipToAddress2?: string;
  shipToAddress3?: string;
  shipToCity: string;
  shipToState: string;
  shipToZip: string;
  shipToCountry: string;
  shipToPhone: string;
  shipToEmail?: string;
  items: NalpacOrderItem[];
  orderNotes?: string;
  deliveryInstructions?: string;
  signatureRequired?: boolean;
  orderDate?: string; // YYYY-MM-DD; defaults to today
}

export interface NalpacOrderResponse {
  success: boolean;
  orderId?: string;
  message?: string;
  error?: string;
}

export interface NalpacCarrier {
  id: number;
  name: string;
}

// --- Auth helpers ---

const DEFAULT_BASE_URL = "https://api2.nalpac.com";
const LOCATION_NALPAC = 15;
const LOCATION_ENTRENUE = 25;

function getAuthHeader(credentials: NalpacCredentials): string {
  const encoded = Buffer.from(
    `${credentials.username}:${credentials.password}`
  ).toString("base64");
  return `Basic ${encoded}`;
}

function getBaseUrl(credentials: NalpacCredentials): string {
  return credentials.baseUrl || DEFAULT_BASE_URL;
}

function jsonHeaders(credentials: NalpacCredentials): Record<string, string> {
  return {
    Authorization: getAuthHeader(credentials),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// --- Product Catalog ---

/**
 * Fetch a page of products for a specific location.
 * GET /api/product?pageNumber=X&pageSize=Y&LocationId=Z
 */
async function fetchProductsForLocation(
  credentials: NalpacCredentials,
  page: number,
  pageSize: number,
  locationId: number
): Promise<NalpacProduct[]> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/product?pageNumber=${page}&pageSize=${pageSize}&LocationId=${locationId}&stripDescriptionHTML=true&excludeDiscontinued=true`;

  console.log(`[nalpac] fetchProducts: GET ${url}`);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: getAuthHeader(credentials),
        Accept: "application/json",
      },
    });
  } catch (netErr) {
    throw new Error(`Nalpac: network error connecting to ${url}: ${netErr}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Nalpac authentication failed (HTTP ${response.status}). ` +
      `Verify your Customer ID and API password in Settings. ` +
      `Note: username must be your numeric Customer ID, not your email.`
    );
  }
  if (!response.ok) {
    throw new Error(
      `Nalpac product fetch failed (HTTP ${response.status} from ${url}).`
    );
  }

  const data = await response.json() as any;
  const items = extractList(data);

  console.log(
    `[nalpac] fetchProducts: location=${locationId} page=${page} ` +
    `received ${items.length} items`
  );

  return items.map((item: any) => mapNalpacProduct(item, locationId));
}

/**
 * Fetch Nalpac product catalog (paginated). If credentials.includeEntrenue
 * is true, also pulls the Entrenue catalog (LocationId=25) and concatenates.
 */
export async function fetchProducts(
  credentials: NalpacCredentials,
  page = 1,
  pageSize = 500
): Promise<NalpacProduct[]> {
  const nalpacItems = await fetchProductsForLocation(
    credentials, page, pageSize, LOCATION_NALPAC
  );
  if (!credentials.includeEntrenue) {
    return nalpacItems;
  }

  // Entrenue catalog
  const entrenueItems = await fetchProductsForLocation(
    credentials, page, pageSize, LOCATION_ENTRENUE
  );
  return [...nalpacItems, ...entrenueItems];
}

/**
 * GET /api/product/{sku}?LocationId=X
 */
export async function getProductBySku(
  credentials: NalpacCredentials,
  sku: string,
  locationId: number = LOCATION_NALPAC
): Promise<NalpacProduct | null> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/product/${encodeURIComponent(sku)}?LocationId=${locationId}&stripDescriptionHTML=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(credentials),
      Accept: "application/json",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Nalpac getProductBySku failed (HTTP ${response.status})`);
  }
  const data = await response.json() as any;
  return mapNalpacProduct(data, locationId);
}

/**
 * GET /api/product?upc={upc}&LocationId=X
 */
export async function getProductByUpc(
  credentials: NalpacCredentials,
  upc: string,
  locationId: number = LOCATION_NALPAC
): Promise<NalpacProduct | null> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/product?upc=${encodeURIComponent(upc)}&LocationId=${locationId}&stripDescriptionHTML=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(credentials),
      Accept: "application/json",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Nalpac getProductByUpc failed (HTTP ${response.status})`);
  }
  const data = await response.json() as any;

  // UPC endpoint may return a single object or a list; normalize
  const items = extractList(data);
  if (items.length === 0 && data && typeof data === "object" && !Array.isArray(data)) {
    return mapNalpacProduct(data, locationId);
  }
  return items.length > 0 ? mapNalpacProduct(items[0], locationId) : null;
}

function extractList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const keys = Object.keys(data);
  const candidate =
    data.items || data.Items ||
    data.products || data.Products ||
    data.data || data.Data ||
    data.results || data.Results ||
    data.records || data.Records ||
    data.value || data.Value;
  if (Array.isArray(candidate)) return candidate;
  // Fallback: find the first array-valued property
  const arrayKey = keys.find((k) => Array.isArray(data[k]));
  return arrayKey ? data[arrayKey] : [];
}

function mapNalpacProduct(item: any, locationId: number): NalpacProduct {
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
      item.imageUrl || item.ImageUrl || item.image_url || item.ImageURL ||
      item.image || item.Image || item.primaryImage || item.PrimaryImage ||
      item.primaryImageUrl || item.PrimaryImageUrl || item.primaryImageURL ||
      item.thumbnail || item.Thumbnail || item.thumbnailUrl || item.ThumbnailUrl ||
      item.productImage || item.ProductImage || item.productImageUrl ||
      item.largePicturePath || item.LargePicturePath || item.pictureUrl || item.PictureUrl ||
      "",
      ...(item.additionalImages ? (Array.isArray(item.additionalImages) ? item.additionalImages : [item.additionalImages]) : []),
      ...(item.ImageUrls ? (Array.isArray(item.ImageUrls) ? item.ImageUrls : [item.ImageUrls]) : []),
      ...(item.imageUrls ? (Array.isArray(item.imageUrls) ? item.imageUrls : [item.imageUrls]) : []),
    ].filter((url): url is string => typeof url === "string" && url.startsWith("http")),
    weight: item.weight ? parseFloat(String(item.weight)) : undefined,
    dimensions: {
      height: item.height ? parseFloat(String(item.height)) : undefined,
      width: item.width ? parseFloat(String(item.width)) : undefined,
      depth: item.depth || item.length ? parseFloat(String(item.depth || item.length)) : undefined,
    },
    locationId,
  };
}

// --- Inventory ---
// Nalpac v2 docs do not expose a separate /api/inventory endpoint; inventory
// is the `quantityAvailable` field on the product response. Use getProductBySku
// per SKU or fetchProducts for bulk.

/**
 * Check inventory for specific SKUs by calling the per-SKU endpoint.
 * Callers should batch this to avoid rate limiting.
 */
export async function checkInventory(
  credentials: NalpacCredentials,
  skus: string[],
  locationId: number = LOCATION_NALPAC
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  for (const sku of skus) {
    try {
      const product = await getProductBySku(credentials, sku, locationId);
      results.set(sku, product?.inventoryQty ?? 0);
    } catch {
      results.set(sku, 0);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return results;
}

// --- Place Order ---

/**
 * Submit a new order. Payload matches the v2 docs Create Order schema exactly.
 * POST /api/order
 */
export async function placeOrder(
  credentials: NalpacCredentials,
  order: NalpacOrderRequest
): Promise<NalpacOrderResponse> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/order`;

  const orderDate = order.orderDate || new Date().toISOString().slice(0, 10);
  const shippingOptionId = Number(order.shippingOptionId);
  if (!Number.isFinite(shippingOptionId) || shippingOptionId <= 0) {
    return {
      success: false,
      error: `Invalid shippingOptionId: ${order.shippingOptionId}. Must be a numeric carrier ID from /api/carrier.`,
    };
  }

  const payload = {
    OrderDate: orderDate,
    PoNumber: order.poNumber,
    OrderNotes: order.orderNotes || "",
    ShippingAddress: {
      Name: order.shipToName,
      Address1: order.shipToAddress1,
      Address2: order.shipToAddress2 || "",
      Address3: order.shipToAddress3 || "",
      City: order.shipToCity,
      State: order.shipToState,
      ZipCode: order.shipToZip,
      Country: order.shipToCountry,
    },
    ShipToPhoneNumber: order.shipToPhone,
    ShipToEmailAddress: order.shipToEmail || "",
    ShippingOptionId: shippingOptionId,
    DeliveryInstructions: order.deliveryInstructions || "",
    SignatureRequired: order.signatureRequired ?? false,
    CreateOrderRequestLines: order.items.map((item) => ({
      Sku: item.itemNumber,
      Quantity: item.quantity,
    })),
  };

  console.log(`[nalpac] placeOrder: POST ${url} (PO=${order.poNumber})`);

  const response = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(credentials),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    console.log(`[nalpac] placeOrder: failed HTTP ${response.status}: ${errorText}`);
    return { success: false, error: `HTTP ${response.status}: ${errorText}` };
  }

  const data = await response.json() as any;
  const orderId =
    data.orderNumber || data.OrderNumber ||
    data.orderId || data.OrderId ||
    data.id || data.Id || "";

  return {
    success: true,
    orderId: String(orderId),
    message: data.message || data.Message || "Order submitted successfully",
  };
}

// --- Order Status ---

/**
 * GET /api/order/{orderNumber}
 */
export async function getOrderStatus(
  credentials: NalpacCredentials,
  orderNumber: string
): Promise<{
  status: string;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
  poNumber?: string;
}> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/order/${encodeURIComponent(orderNumber)}`;

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
    status: data.status || data.Status || data.orderStatus || "unknown",
    trackingNumber: data.trackingNumber || data.TrackingNumber || data.tracking || undefined,
    carrier: data.carrier || data.Carrier || data.shippingCarrier || undefined,
    shippedAt: data.shipDate || data.ShipDate || data.shippedDate || data.ShippedDate || undefined,
    poNumber: data.poNumber || data.PoNumber || undefined,
  };
}

/**
 * GET /api/order?poNumber=X
 * Look up a Nalpac order using your own PO number.
 */
export async function getOrderByPoNumber(
  credentials: NalpacCredentials,
  poNumber: string
): Promise<{ orderNumber: string; status: string; trackingNumber?: string } | null> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/order?poNumber=${encodeURIComponent(poNumber)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(credentials),
      Accept: "application/json",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Nalpac getOrderByPoNumber HTTP ${response.status}`);
  }
  const data = await response.json() as any;
  const orders = extractList(data);
  if (orders.length === 0) return null;
  const o = orders[0];
  return {
    orderNumber: String(o.orderNumber || o.OrderNumber || o.id || ""),
    status: String(o.status || o.Status || o.orderStatus || "unknown"),
    trackingNumber: o.trackingNumber || o.TrackingNumber || undefined,
  };
}

// --- Carriers ---

/**
 * GET /api/carrier
 * Fetch the live list of shipping carriers/methods and their IDs.
 */
export async function fetchCarriers(
  credentials: NalpacCredentials
): Promise<NalpacCarrier[]> {
  const baseUrl = getBaseUrl(credentials);
  const url = `${baseUrl}/api/carrier`;

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthHeader(credentials),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Nalpac fetchCarriers HTTP ${response.status}`);
  }

  const data = await response.json() as any;
  const items = extractList(data);
  return items.map((c: any) => ({
    id: Number(c.id || c.Id || c.shippingOptionId || c.ShippingOptionId || c.carrierId || c.CarrierId || 0),
    name: String(c.name || c.Name || c.label || c.Label || c.description || ""),
  })).filter((c: NalpacCarrier) => c.id > 0);
}

// --- Validate Credentials ---

export async function validateCredentials(
  credentials: NalpacCredentials
): Promise<{ valid: boolean; error?: string }> {
  console.log(`[nalpac] validateCredentials: fetching 1 product from LocationId=15`);
  try {
    await fetchProductsForLocation(credentials, 1, 1, LOCATION_NALPAC);
    console.log(`[nalpac] validateCredentials: success`);
    return { valid: true };
  } catch (error) {
    const msg = String(error);
    console.log(`[nalpac] validateCredentials: failed: ${msg}`);
    // Give a user-friendly message if the error looks like auth
    if (msg.includes("401") || msg.includes("403") || /authentication/i.test(msg)) {
      return {
        valid: false,
        error:
          "Authentication failed. Make sure your username is your Nalpac Customer ID " +
          "(e.g. 142959), not your email address, and that your API password matches " +
          "what Nalpac issued.",
      };
    }
    return { valid: false, error: msg };
  }
}

// --- Shipping Methods (fallback static list) ---
// The authoritative source is GET /api/carrier. This list is a fallback used
// in the Settings UI dropdown when we can't hit the live endpoint.

export const SHIPPING_METHODS = [
  { code: "131966", label: "CHEAPEST Method" },
  { code: "133481", label: "Best Rate Standard" },
  { code: "137490", label: "Best Rate UPS/FedEx" },
  { code: "100002", label: "UPS Ground" },
  { code: "129312", label: "FedEx Home Delivery" },
  { code: "100003", label: "FedEx Ground Service" },
  { code: "121349", label: "UPS 2nd Day Air" },
  { code: "128082", label: "FedEx 2nd Day" },
  { code: "121346", label: "UPS Next Day Air" },
  { code: "121347", label: "UPS Next Day Air Saver" },
  { code: "125816", label: "Priority Mail" },
  { code: "141850", label: "USPS Ground Advantage" },
  { code: "142922", label: "Endicia Ground Advantage" },
  { code: "142923", label: "Endicia Priority" },
  { code: "133483", label: "Best Rate 2nd Day" },
  { code: "133482", label: "Best Rate Next Day" },
  { code: "137260", label: "Best Rate Expedited" },
  { code: "137261", label: "Best Rate Overnight" },
  { code: "133795", label: "Best Rate 3 Day" },
];

export const NALPAC_CARRIER_CODES: Record<string, string> = {
  "131966": "CHEAPEST Method",
  "133481": "Best Rate Standard",
  "133483": "Best Rate 2nd Day",
  "133486": "Best Rate 2nd Day International",
  "133795": "Best Rate 3 Day",
  "137260": "Best Rate Expedited",
  "133482": "Best Rate Next Day",
  "133485": "Best Rate Next Day International",
  "137261": "Best Rate Overnight",
  "137490": "Best Rate UPS/Fedex",
  "133484": "Best Rate Standard International",
  "100002": "UPS Ground",
  "100003": "FedEx Ground Service",
  "100005": "USPS",
  "121346": "UPS Next Day Air",
  "100011": "UPS Next Day Air Early AM",
  "121347": "UPS Next Day Air Saver",
  "121348": "UPS 2nd Day Air AM",
  "121349": "UPS 2nd Day Air",
  "121350": "UPS 3 Day Select",
  "125211": "FedEx Express Saver",
  "125212": "FedEx Standard Overnight",
  "125816": "Priority Mail",
  "125904": "UPS Standard",
  "128082": "FedEx 2nd Day",
  "129312": "FedEx Home Delivery",
  "130765": "Fed Ex Freight",
  "131818": "PRIORITY MAIL 1-DAY",
  "131819": "PRIORITY MAIL 2-DAY",
  "131820": "PRIORITY MAIL 3-DAY",
  "131398": "Priority Mail Express",
  "136663": "FedEx Priority Overnight",
  "141850": "USPS Ground Advantage",
  "142922": "Endicia Ground Advantage",
  "142923": "Endicia Priority",
  "142924": "Endicia Express",
  "143097": "FedEx One Rate",
};

export const LOCATION_IDS = {
  NALPAC: LOCATION_NALPAC,
  ENTRENUE: LOCATION_ENTRENUE,
};
