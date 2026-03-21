/**
 * Eldorado API Integration
 * API: https://eldoradopartner.com/ (REST + XML)
 * SFTP: ftp://aphrodite.eldorado.net
 * Auth: store-specific "key" (IP-locked)
 */

// ─── Types ───

export interface EldoradoCredentials {
  key: string;         // store-specific API key from Eldorado
  accountId: string;   // customer account ID
  sftpUsername: string;
  sftpPassword: string;
  sftpHost?: string;   // defaults to aphrodite.eldorado.net
}

export interface EldoradoProduct {
  model: string;       // products_model = their SKU
  upc: string;
  title: string;
  description: string;
  price: number;       // wholesale cost
  msrp?: number;
  qty: number;
  category: string;
  categoryId: string;
  manufacturer: string;
  images: string[];    // model-based image paths
  weight?: number;
  dimensions?: {
    height?: string;
    length?: string;
    diameter?: string;
  };
  properties?: {
    color?: string;
    material?: string;
    size?: string;
    ounces?: string;
    packaging?: string;
    texture?: string;
    fragrance?: string;
    flavor?: string;
    functions?: string[];
  };
  discountPercent?: number; // from discounts API
}

export interface EldoradoOrderProduct {
  code: string;    // products_model
  quantity: number;
}

export interface EldoradoOrderRequest {
  sourceOrderNumber: string; // numeric, max 10 chars
  custPONumber: string;
  name: string;           // customer first + last (max 25 chars)
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;      // 2-char
  zipCode: string;
  countryCode: string;    // 2-char
  phoneNumber: string;    // numbers only, max 20
  shipVia: string;        // see SHIPPING_CODES
  specialInstructions?: string;
  signatureRequired?: boolean;
  products: EldoradoOrderProduct[];
}

export interface EldoradoOrderResponse {
  success: boolean;
  referenceId?: string;
  error?: string;
}

export interface EldoradoShippingUpdate {
  responseCode: string;
  webOrderNumber: string;
  trackingNumber: string;
  carrierCode: string;
  serviceCode: string;
  dateShipment: string;
  expectedDelivery: string;
  shippingCost?: number;
}

// ─── API Base URLs ───

const BASE_URL = "https://eldoradopartner.com";
const TEST_ORDER_URL = `${BASE_URL}/test/orderTest.php`;
const LIVE_ORDER_URL = `${BASE_URL}/order/index.php`;
const QUANTITY_URL = `${BASE_URL}/quantitycheck/`;
const SHIPPING_URL = `${BASE_URL}/shipping_updates/index.php`;
const DISCOUNTS_URL = `${BASE_URL}/discounts/`;
const ORDER_HISTORY_URL = `${BASE_URL}/order_history/`;
const OPEN_ORDERS_URL = `${BASE_URL}/open_orders/`;
const SFTP_HOST = "aphrodite.eldorado.net";

// ─── XML Parsing helpers ───

function getXmlValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)<\/${tag}>`).exec(xml);
  return match ? match[1].trim() : "";
}

function buildPost(body: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body,
  };
}

// ─── Quantity Check ───

export async function checkQuantity(
  credentials: EldoradoCredentials,
  model: string,
  qtyNeeded: number = 1
): Promise<number> {
  const xml = `<key>${credentials.key}</key>\n<item>${model}</item>`;
  const response = await fetch(QUANTITY_URL, buildPost(xml));
  if (!response.ok) throw new Error(`Eldorado qty check HTTP ${response.status}`);
  const text = await response.text();
  const amount = getXmlValue(text, "amount");
  return parseInt(amount || "0", 10);
}

export async function checkQuantityBatch(
  credentials: EldoradoCredentials,
  models: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  const batchSize = 5;
  for (let i = 0; i < models.length; i += batchSize) {
    const batch = models.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (model) => {
        const qty = await checkQuantity(credentials, model);
        results.set(model, qty);
      })
    );
    if (i + batchSize < models.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return results;
}

// ─── Place Order ───

export async function placeOrder(
  credentials: EldoradoCredentials,
  order: EldoradoOrderRequest,
  testMode = false
): Promise<EldoradoOrderResponse> {
  const productsXml = order.products
    .map((p) => `<Product>\n<Code>${p.code}</Code>\n<Quantity>${p.quantity}</Quantity>\n</Product>`)
    .join("\n");

  const xml = `<key>${credentials.key}</key>
<AccountId>${credentials.accountId}</AccountId>
<Name>${order.name.substring(0, 25)}</Name>
<AddressLine1>${order.addressLine1.substring(0, 30)}</AddressLine1>
${order.addressLine2 ? `<AddressLine2>${order.addressLine2.substring(0, 25)}</AddressLine2>` : ""}
<City>${order.city.substring(0, 15)}</City>
<StateCode>${order.stateCode.substring(0, 2)}</StateCode>
<ZipCode>${order.zipCode.substring(0, 10)}</ZipCode>
<CountryCode>${order.countryCode.substring(0, 2)}</CountryCode>
<PhoneNumber>${order.phoneNumber.replace(/\D/g, "").substring(0, 20)}</PhoneNumber>
<EnteredByCode>websites</EnteredByCode>
<SourceCode>API</SourceCode>
<CustPONumber>${order.custPONumber}</CustPONumber>
<ShipVia>${order.shipVia}</ShipVia>
${order.specialInstructions ? `<SpecialInstructions>${order.specialInstructions.substring(0, 42)}</SpecialInstructions>` : ""}
<SourceOrderNumber>${order.sourceOrderNumber.substring(0, 10)}</SourceOrderNumber>
${order.signatureRequired ? "<signatureRequired>Y</signatureRequired>" : ""}
<Products>
${productsXml}
</Products>`;

  const url = testMode ? TEST_ORDER_URL : LIVE_ORDER_URL;
  const response = await fetch(url, buildPost(xml));
  if (!response.ok) throw new Error(`Eldorado order HTTP ${response.status}`);

  const text = await response.text();
  if (text.includes("<Success>")) {
    const refMatch = /Reference ID: (\d+)/.exec(text);
    return { success: true, referenceId: refMatch?.[1] };
  }
  const error = getXmlValue(text, "Error");
  return { success: false, error: error || "Unknown error" };
}

// ─── Shipping Updates ───

export async function getShippingUpdate(
  credentials: EldoradoCredentials,
  orderId: string,
  includeShippingCost = false
): Promise<EldoradoShippingUpdate> {
  const xml = `<key>${credentials.key}</key>
<XML_Orders>
<Order>
<Order_id>${orderId}</Order_id>
<Order_customer>${credentials.accountId}</Order_customer>
${includeShippingCost ? "<Order_shipping_cost>true</Order_shipping_cost>" : ""}
</Order>
</XML_Orders>`;

  const response = await fetch(SHIPPING_URL, buildPost(xml));
  if (!response.ok) throw new Error(`Eldorado shipping update HTTP ${response.status}`);
  const text = await response.text();

  return {
    responseCode: getXmlValue(text, "response_code"),
    webOrderNumber: getXmlValue(text, "web_order_number"),
    trackingNumber: getXmlValue(text, "tracking_number"),
    carrierCode: getXmlValue(text, "carrier_code"),
    serviceCode: getXmlValue(text, "service_code"),
    dateShipment: getXmlValue(text, "date_shipment"),
    expectedDelivery: getXmlValue(text, "expected_delivery"),
    shippingCost: includeShippingCost
      ? parseFloat(getXmlValue(text, "shipping_cost") || "0")
      : undefined,
  };
}

// ─── Discounts ───

export async function getDiscounts(
  credentials: EldoradoCredentials
): Promise<Map<string, number>> {
  const xml = `<key>${credentials.key}</key>\n<accountId>${credentials.accountId}</accountId>`;
  const response = await fetch(DISCOUNTS_URL, buildPost(xml));
  if (!response.ok) throw new Error(`Eldorado discounts HTTP ${response.status}`);
  const text = await response.text();

  const discounts = new Map<string, number>();
  const pattern = /<item>\s*<product_model>([^<]+)<\/product_model>\s*<discount_percent>([^<]+)<\/discount_percent>\s*<\/item>/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    discounts.set(match[1], parseFloat(match[2]));
  }
  return discounts;
}

// ─── SFTP Product Feed (parses products.xml downloaded via SFTP) ───

/**
 * Parse Eldorado products.xml content into product objects.
 * The XML is fetched via SFTP in a background job.
 */
export function parseProductsXml(xmlContent: string): EldoradoProduct[] {
  const products: EldoradoProduct[] = [];
  const productPattern = /<PRODUCTS>([\s\S]*?)<\/PRODUCTS>/g;
  let match;

  function getVal(block: string, tag: string): string {
    const m = new RegExp(`<${tag}>([^<]*)<\/${tag}>`).exec(block);
    return m ? m[1].trim() : "";
  }

  while ((match = productPattern.exec(xmlContent)) !== null) {
    const block = match[1];
    const model = getVal(block, "PRODUCTS_MODEL");
    if (!model) continue;

    const price = parseFloat(getVal(block, "PRODUCTS_PRICE") || "0");
    const baseImageUrl = "https://eldorado.net/images";
    const images = ["small", "medium", "large", "xl"].map(
      (size) => `${baseImageUrl}/${size}/${model}.jpg`
    );
    // Also include a/b/c variant images
    ["a", "b", "c"].forEach((suffix) => {
      images.push(`${baseImageUrl}/large/${model}${suffix}.jpg`);
    });

    const functions: string[] = [];
    ["PROP_FUNCTION_1", "PROP_FUNCTION_2", "PROP_FUNCTION_3"].forEach((tag) => {
      const v = getVal(block, tag);
      if (v) functions.push(v);
    });

    products.push({
      model,
      upc: getVal(block, "ITEM_UPC"),
      title: getVal(block, "PRODUCTS_NAME"),
      description: getVal(block, "PRODUCTS_DESCRIPTION"),
      price,
      qty: parseInt(getVal(block, "PRODUCTS_QUANTITY") || "0", 10),
      category: getVal(block, "PRODUCTS_TYPE"),
      categoryId: "",
      manufacturer: getVal(block, "MANUFACTURERS_NAME"),
      images,
      weight: parseFloat(getVal(block, "PRODUCTS_WEIGHT") || "0") || undefined,
      dimensions: {
        height: getVal(block, "ITEM_HEIGHT") || undefined,
        length: getVal(block, "ITEM_LENGTH") || undefined,
        diameter: getVal(block, "ITEM_DIAMETER") || undefined,
      },
      properties: {
        color: getVal(block, "PROP_COLOR") || undefined,
        material: getVal(block, "PROP_MATERIAL") || undefined,
        size: getVal(block, "PROP_SIZE") || undefined,
        ounces: getVal(block, "PROP_OUNCES") || undefined,
        packaging: getVal(block, "PROP_PACKAGING") || undefined,
        texture: getVal(block, "PROP_TEXTURE") || undefined,
        fragrance: getVal(block, "PROP_FRAGRANCE") || undefined,
        flavor: getVal(block, "PROP_FLAVOR") || undefined,
        functions: functions.length > 0 ? functions : undefined,
      },
    });
  }
  return products;
}

/**
 * Parse Eldorado inventory.xml (hourly updates)
 */
export function parseInventoryXml(xmlContent: string): Map<string, number> {
  const inventory = new Map<string, number>();
  const pattern = /<PRODUCT>\s*<MODEL>([^<]+)<\/MODEL>\s*<QUANTITY>([^<]+)<\/QUANTITY>\s*<\/PRODUCT>/g;
  let match;
  while ((match = pattern.exec(xmlContent)) !== null) {
    inventory.set(match[1], parseInt(match[2], 10));
  }
  return inventory;
}

// ─── Validate Credentials ───

export async function validateCredentials(
  credentials: EldoradoCredentials
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Try a quantity check on a known test item
    const xml = `<key>${credentials.key}</key>\n<item>TEST_ITEM</item>`;
    const response = await fetch(QUANTITY_URL, buildPost(xml));
    // If we get a 200 back (even with an error response), the key is likely valid
    if (response.status === 403 || response.status === 401) {
      return { valid: false, error: "Invalid API key. Check that your IP matches what Eldorado has on file." };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

// ─── Shipping Codes (Appendix A) ───

export const SHIPPING_CODES = [
  { code: "F1F", label: "FedEx First Overnight (Commercial)" },
  { code: "F1FR", label: "FedEx First Overnight (Residential)" },
  { code: "F1DA", label: "FedEx Priority Overnight (Commercial)" },
  { code: "F1DAR", label: "FedEx Priority Overnight (Residential)" },
  { code: "F1DP", label: "FedEx Standard Overnight (Commercial)" },
  { code: "F1DPR", label: "FedEx Standard Overnight (Residential)" },
  { code: "F2D", label: "FedEx 2 Day Air (Commercial)" },
  { code: "F2DR", label: "FedEx 2 Day Air (Residential)" },
  { code: "F3D", label: "FedEx Express Saver (Commercial)" },
  { code: "F3DR", label: "FedEx Express Saver (Residential)" },
  { code: "FG", label: "FedEx Ground (USA Commercial & Canada)" },
  { code: "FHD", label: "FedEx Ground Home Delivery" },
  { code: "M03", label: "USPS Priority Mail Express" },
  { code: "M02", label: "USPS Priority Mail" },
  { code: "M02F", label: "USPS First-Class Mail" },
  { code: "M01", label: "USPS Standard Post" },
  { code: "M13", label: "USPS Priority Mail Express International" },
  { code: "M14", label: "USPS Priority Mail International" },
  { code: "M15", label: "USPS First-Class Package International" },
  { code: "U1D", label: "UPS Next Day Air (Commercial)" },
  { code: "U1DR", label: "UPS Next Day Air (Residential)" },
  { code: "U1DA", label: "UPS Next Day Air Early AM (Commercial)" },
  { code: "U2D", label: "UPS 2nd Day Air (Commercial)" },
  { code: "U2DR", label: "UPS 2nd Day Air (Residential)" },
  { code: "U3D", label: "UPS 3 Day Select (Commercial)" },
  { code: "U3DR", label: "UPS 3 Day Select (Residential)" },
  { code: "UG", label: "UPS Ground (Commercial)" },
  { code: "UGR", label: "UPS Ground (Residential)" },
  { code: "PICKUP", label: "Customer Pickup" },
  { code: "B2CBR", label: "Best Rate (Cheapest Carrier)" },
  { code: "BR1D", label: "Best Rate 1 Day" },
  { code: "BR2D", label: "Best Rate 2 Day" },
  { code: "BR3D", label: "Best Rate 3 Day" },
];
