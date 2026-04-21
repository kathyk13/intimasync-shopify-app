/**
 * ECN / Adult Drop Shipper (ADS) API Integration
 * Official docs: "Order API ECN (01).doc" provided by Jamie Horne
 * Feed: XML differential at feed.adultdropshipper.com
 * Orders: XML POST at adultshipper.com
 * Auth: clientid + clientstoreid + passkey (3 values, provided by ADS)
 *
 * Warehouse locations (per Jamie's email): CA, NJ, PA, FL
 * Fill types: 2 = Order Complete, 4 = Fill & Kill
 */

// --- Types ---

export interface ECNCredentials {
  clientId: string;      // integer provided by ADS
  clientStoreId: string; // integer provided by ADS
  passkey: string;       // ADS security key
}

export interface ECNProduct {
  itemId: string;        // primary identifier (integer)
  sku: string;           // alphanumeric SKU (do NOT use as primary key per docs)
  upc: string;
  title: string;
  alternateTitle: string;
  description: string;
  htmlDescription: string; // base64 decoded HTML description
  standardPrice: number;
  stock: number;         // 0=Not Available, 1=Short Wait, 2=Available, 3=Long Wait
  manufacturer: string;
  brand: string;
  categories: string[];
  images: string[];
  weight: number;
  height: number;
  width: number;
  length: number;
  releaseDate: string;
  dateCreated: string;
  dateUpdated: string;
  discontinued: boolean;
  deliveryAllowed: boolean; // can ship to continental US
  multiplesOf: number;      // order qty must be multiple of this
}

export interface ECNOrderItem {
  itemSKU: string;
  itemId: string;        // required by ADS alongside SKU
  quantity: number;
  price?: number;        // required for international/military orders
}

export interface ECNOrderRequest {
  refOrderNumber: string;
  orderTotal: number;
  genericShippingMethodId: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone1: string;
  phone2?: string;
  phone3?: string;
  shipToAddress1: string;
  shipToAddress2?: string;
  shipToCity: string;
  shipToState: string;    // 2-letter code (e.g. NJ)
  shipToZip: string;
  shipToCountry: string;  // 2-letter code (e.g. US)
  fillStatusId?: number;  // 2 = Order Complete, 4 = Fill & Kill
  packingIncludesId?: number; // 1 = packing slip, 2 = invoice
  orderPauseLevelId?: number; // 1 = None, 2 = Paused. Do NOT enter 0.
  invoiceHeaderBase64?: string;
  invoiceFooterText?: string; // max 1500 chars
  signatureConfirmationId?: number; // 1 = yes, 0 = no
  insuranceId?: number;   // 1 = yes, 0 = no
  saturdayDeliveryId?: number; // 1 = yes, defaults to 0
  items: ECNOrderItem[];
}

export interface ECNOrderResponse {
  success: boolean;
  orderId?: string;
  refOrderNumber?: string;
  status?: string;
  error?: string;
  rejectedReason?: string;
  itemsNotFound?: { sku: string; itemId: string; reason: string }[];
}

export interface ECNOrderStatus {
  orderId: string;
  clientId: string;
  orderStatus: string;    // Pending Processing, Filled, Backordered, Shipped
  orderPauseStatus: string;
  refOrderNumber: string;
  orderDate: string;
  orderTime: string;
  shippingMethodId: string;
  shipFromLocation: string; // CA, NJ, PA, FL, or Unassigned
  shipments: ECNShipment[];
  lineItems: ECNLineItemStatus[];
  backorderedItems: { sku: string; itemId: string; quantity: number }[];
  orderActions: { actionId: string; description: string }[];
}

export interface ECNShipment {
  shipmentId: string;
  status: string;
  carrier: string;
  method: string;
  trackingNumber: string;
  date?: string;
  time?: string;
  publishedRate?: string;
  packages: ECNShipmentPackage[];
}

export interface ECNShipmentPackage {
  trackingNumber: string;
  itemSku: string;
  itemQuantity: number;
  itemId: string;
  status: string;
  weight: string;
  packageId: string;
}

export interface ECNLineItemStatus {
  sku: string;
  itemId: string;
  supplier: string;
  itemStatus: string;
  quantity: number;
  allocated: number;
  packaged: number;
  cancelled: number;
  backordered: number;
}

// --- Shipping Methods ---
export const SHIPPING_METHODS = [
  { id: 6, label: "Cheapest (Rate Shop)", carrier: "Rate Shop" },
  { id: 1, label: "Next Day (Rate Shop)", carrier: "Rate Shop" },
  { id: 2, label: "Two Day (Rate Shop)", carrier: "Rate Shop" },
  { id: 3, label: "Three Day (Rate Shop)", carrier: "Rate Shop" },
  { id: 100, label: "USPS First-Class", carrier: "USPS" },
  { id: 101, label: "USPS Priority Mail", carrier: "USPS" },
  { id: 102, label: "USPS Express Mail", carrier: "USPS" },
  { id: 103, label: "USPS Parcel Post", carrier: "USPS" },
  { id: 104, label: "USPS Media Mail", carrier: "USPS" },
  { id: 105, label: "USPS Library", carrier: "USPS" },
  { id: 106, label: "USPS Express Mail International", carrier: "USPS" },
  { id: 107, label: "USPS Priority Mail International", carrier: "USPS" },
  { id: 108, label: "UPS Next Day Air Early AM", carrier: "UPS" },
  { id: 109, label: "UPS Next Day Air", carrier: "UPS" },
  { id: 110, label: "UPS Next Day Air Saver", carrier: "UPS" },
  { id: 111, label: "UPS 2nd Day Air AM", carrier: "UPS" },
  { id: 112, label: "UPS 2nd Day Air", carrier: "UPS" },
  { id: 113, label: "UPS 3 Day Select", carrier: "UPS" },
  { id: 114, label: "UPS Ground", carrier: "UPS" },
  { id: 115, label: "UPS International Standard", carrier: "UPS" },
  { id: 116, label: "UPS Worldwide Express", carrier: "UPS" },
  { id: 117, label: "UPS Worldwide Express Plus", carrier: "UPS" },
  { id: 118, label: "UPS Worldwide Expedited", carrier: "UPS" },
  { id: 119, label: "UPS International Saver", carrier: "UPS" },
  { id: 120, label: "USPS Bound Printed Matter", carrier: "USPS" },
  { id: 121, label: "FedEx Priority Overnight", carrier: "FedEx" },
  { id: 122, label: "FedEx Standard Overnight", carrier: "FedEx" },
  { id: 123, label: "FedEx 2Day", carrier: "FedEx" },
  { id: 124, label: "FedEx Express Saver", carrier: "FedEx" },
  { id: 125, label: "FedEx Home Delivery", carrier: "FedEx" },
  { id: 126, label: "FedEx Ground", carrier: "FedEx" },
  { id: 127, label: "FedEx International Economy", carrier: "FedEx" },
  { id: 128, label: "FedEx International First", carrier: "FedEx" },
  { id: 129, label: "FedEx International Priority", carrier: "FedEx" },
  { id: 130, label: "FedEx 1Day Freight", carrier: "FedEx" },
  { id: 131, label: "FedEx 2Day Freight", carrier: "FedEx" },
  { id: 132, label: "FedEx 3Day Freight", carrier: "FedEx" },
  { id: 133, label: "FedEx International Economy Freight", carrier: "FedEx" },
  { id: 134, label: "FedEx International Priority Freight", carrier: "FedEx" },
  { id: 135, label: "USPS First-Class Mail International", carrier: "USPS" },
  { id: 138, label: "DHL GlobalMail Priority", carrier: "DHL" },
  { id: 149, label: "DHL Domestic Standard", carrier: "DHL" },
  { id: 151, label: "UPS Mail Innovations", carrier: "UPS" },
];

// Convenience export for Settings page dropdowns
export const SHIPPING_CODES = SHIPPING_METHODS.map((m) => ({
  code: String(m.id),
  label: m.label,
}));

// Fill status options
export const FILL_STATUS = {
  ORDER_COMPLETE: 2,
  FILL_AND_KILL: 4,
};

// Order action IDs
export const ORDER_ACTIONS = {
  CANCEL: 5,
  PAUSE: 20,
  UNPAUSE: 22,
};

// Stock status values
export const STOCK_STATUS: Record<number, string> = {
  0: "Not Available",
  1: "Short Wait",
  2: "Available",
  3: "Long Wait",
};

// --- URLs ---
const FEED_BASE = "https://feed.adultdropshipper.com";
const ORDER_BASE = "https://adultshipper.com/back";

// --- XML Helpers ---

/** Extract text content of a single XML tag (non-greedy) */
function xmlText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1].trim() : "";
}

/** Extract all occurrences of a tag */
function xmlTextAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

/** Extract all <item>...</item> blocks from XML */
function extractItems(xml: string): string[] {
  const regex = /<item>([\s\S]*?)<\/item>/gi;
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

/** Build image URL from itemId and size ID per ECN naming convention */
function buildImageUrl(itemId: string, sizeId: number): string {
  return `https://s3.amazonaws.com/ecn-watermarks/effex/${itemId}_${sizeId}.jpg`;
}

/** Parse a single <item> XML block into an ECNProduct */
function parseProductItem(itemXml: string): ECNProduct {
  const itemId = xmlText(itemXml, "itemID") || xmlText(itemXml, "itemid");
  const sku = xmlText(itemXml, "itemSKU");

  // Build image URLs based on which image tags have content
  const images: string[] = [];
  const imageFields = [
    { tag: "imageLargeFront", sizeId: 1 },
    { tag: "imageLargeBack", sizeId: 2 },
    { tag: "imageMediumFront", sizeId: 5 },
    { tag: "imageMediumBack", sizeId: 6 },
    { tag: "imageThumbnailFront", sizeId: 9 },
    { tag: "imageThumbnailBack", sizeId: 10 },
  ];
  for (const field of imageFields) {
    const val = xmlText(itemXml, field.tag);
    if (val && val.length > 0) {
      images.push(buildImageUrl(itemId, field.sizeId));
    }
  }

  // Decode base64 HTML description if present
  let htmlDescription = "";
  const htmlBase64 = xmlText(itemXml, "htmlitemdescriptioninbase64format");
  if (htmlBase64 && htmlBase64.length > 0) {
    try {
      htmlDescription = Buffer.from(htmlBase64, "base64").toString("utf-8");
    } catch {
      htmlDescription = "";
    }
  }

  // Parse categoriesV2
  const categories: string[] = [];
  const catItems = xmlTextAll(itemXml, "mastercategories");
  const subItems = xmlTextAll(itemXml, "subcategories");
  catItems.forEach((cat) => {
    if (cat) categories.push(cat);
  });
  subItems.forEach((sub) => {
    if (sub) {
      // subcategories are delimited by "^"
      sub.split("^").forEach((s) => {
        if (s.trim()) categories.push(s.trim());
      });
    }
  });

  return {
    itemId,
    sku,
    upc: xmlText(itemXml, "upc"),
    title: xmlText(itemXml, "title"),
    alternateTitle: xmlText(itemXml, "alternatetitle"),
    description: xmlText(itemXml, "itemDescription"),
    htmlDescription,
    standardPrice: parseFloat(xmlText(itemXml, "standardPrice")) || 0,
    stock: parseInt(xmlText(itemXml, "stock") || "0", 10),
    manufacturer: xmlText(itemXml, "manufacturer"),
    brand: xmlText(itemXml, "brand"),
    categories,
    images,
    weight: parseFloat(xmlText(itemXml, "itemweight")) || 0,
    height: parseFloat(xmlText(itemXml, "height")) || 0,
    width: parseFloat(xmlText(itemXml, "width")) || 0,
    length: parseFloat(xmlText(itemXml, "length")) || 0,
    releaseDate: xmlText(itemXml, "releaseDate"),
    dateCreated: xmlText(itemXml, "dateCreated"),
    dateUpdated: xmlText(itemXml, "dateUpdated"),
    discontinued: xmlText(itemXml, "discontinued").toLowerCase() === "yes",
    deliveryAllowed: xmlText(itemXml, "deliveryallowed") === "1",
    multiplesOf: parseInt(xmlText(itemXml, "multiplesof") || "1", 10),
  };
}

// --- Data Feed ---

/**
 * Fetch the differential XML feed from ECN.
 * Returns add/modify/delete arrays of products.
 * After processing, call updateSyncDate() to advance the differential.
 */
export async function fetchFeed(
  credentials: ECNCredentials
): Promise<{
  add: ECNProduct[];
  modify: ECNProduct[];
  delete: { itemId: string; sku: string }[];
}> {
  const url = `${FEED_BASE}/ecnFeed.cfm?act=read&siteID=${credentials.clientStoreId}&passkey=${credentials.passkey}`;
  console.log(`[ecn] fetchFeed: GET ${url.replace(credentials.passkey, "***")}`);

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`ECN feed HTTP error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();

  // Parse <add> section
  const addSection = xmlText(xml, "add");
  const addItems = extractItems(addSection).map(parseProductItem);

  // Parse <modify> section
  const modifySection = xmlText(xml, "modify");
  const modifyItems = extractItems(modifySection).map(parseProductItem);

  // Parse <delete> section
  const deleteSection = xmlText(xml, "delete");
  const deleteItems = extractItems(deleteSection).map((itemXml) => ({
    itemId: xmlText(itemXml, "itemID") || xmlText(itemXml, "itemid"),
    sku: xmlText(itemXml, "itemSKU"),
  }));

  console.log(
    `[ecn] fetchFeed: ${addItems.length} adds, ${modifyItems.length} modifies, ${deleteItems.length} deletes`
  );

  return { add: addItems, modify: modifyItems, delete: deleteItems };
}

/**
 * Update the sync date on ECN's side so the next feed request
 * returns only changes since this moment.
 * MUST be called after successfully processing the feed.
 */
export async function updateSyncDate(credentials: ECNCredentials): Promise<void> {
  const url = `${FEED_BASE}/ecnFeed.cfm?act=update&siteID=${credentials.clientStoreId}&passkey=${credentials.passkey}`;
  console.log(`[ecn] updateSyncDate: GET ${url.replace(credentials.passkey, "***")}`);

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`ECN sync date update failed: ${response.status}`);
  }
  console.log("[ecn] updateSyncDate: success");
}

// --- Place Order ---

/**
 * Submit an order to ECN via XML POST.
 * The form field must be named "processxmlorder".
 */
export async function placeOrder(
  credentials: ECNCredentials,
  order: ECNOrderRequest
): Promise<ECNOrderResponse> {
  const url = `${ORDER_BASE}/processxmlorder2.cfm?passkey=${credentials.passkey}&clientID=${credentials.clientId}&storeid=${credentials.clientStoreId}`;

  const itemsXml = order.items
    .map(
      (item) => `<item>
<itemSKU>${escapeXml(item.itemSKU)}</itemSKU>
<itemid>${escapeXml(item.itemId)}</itemid>
<quantity>${item.quantity}</quantity>
${item.price != null ? `<price>${item.price.toFixed(2)}</price>` : ""}
</item>`
    )
    .join("\n");

  const orderXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<orders>
<order>
<orderheader>
<refordernumber>${escapeXml(order.refOrderNumber)}</refordernumber>
<ordertotal>${order.orderTotal.toFixed(2)}</ordertotal>
<clientid>${escapeXml(credentials.clientId)}</clientid>
<clientstoreid>${escapeXml(credentials.clientStoreId)}</clientstoreid>
<firstname>${escapeXml(order.firstName)}</firstname>
<lastname>${escapeXml(order.lastName)}</lastname>
<email>${escapeXml(order.email || "")}</email>
<phone1>${escapeXml(order.phone1)}</phone1>
<phone2>${escapeXml(order.phone2 || "")}</phone2>
<phone3>${escapeXml(order.phone3 || "")}</phone3>
<shiptoaddress1>${escapeXml(order.shipToAddress1)}</shiptoaddress1>
<shiptoaddress2>${escapeXml(order.shipToAddress2 || "")}</shiptoaddress2>
<shiptocity>${escapeXml(order.shipToCity)}</shiptocity>
<shiptostate>${escapeXml(order.shipToState)}</shiptostate>
<shiptozip>${escapeXml(order.shipToZip)}</shiptozip>
<shiptocountry>${escapeXml(order.shipToCountry)}</shiptocountry>
<genericshippingmethodid>${order.genericShippingMethodId}</genericshippingmethodid>
${order.fillStatusId != null ? `<fillstatusid>${order.fillStatusId}</fillstatusid>` : ""}
${order.packingIncludesId != null ? `<packingincludesid>${order.packingIncludesId}</packingincludesid>` : ""}
${order.orderPauseLevelId != null ? `<orderpauselevelid>${order.orderPauseLevelId}</orderpauselevelid>` : ""}
${order.invoiceHeaderBase64 ? `<invoiceheaderbase64>${order.invoiceHeaderBase64}</invoiceheaderbase64>` : ""}
${order.invoiceFooterText ? `<invoicefootertext>${escapeXml(order.invoiceFooterText)}</invoicefootertext>` : ""}
${order.signatureConfirmationId != null ? `<signatureconfirmationid>${order.signatureConfirmationId}</signatureconfirmationid>` : ""}
${order.insuranceId != null ? `<insuranceid>${order.insuranceId}</insuranceid>` : ""}
${order.saturdayDeliveryId != null ? `<saturdaydeliveryid>${order.saturdayDeliveryId}</saturdaydeliveryid>` : ""}
</orderheader>
<lineitems>
${itemsXml}
</lineitems>
</order>
</orders>`;

  console.log(`[ecn] placeOrder: POST ${url.replace(credentials.passkey, "***")} ref=${order.refOrderNumber}`);

  // ECN expects the XML as a form field named "processxmlorder"
  const formBody = new URLSearchParams();
  formBody.append("processxmlorder", orderXml);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  if (!response.ok) {
    throw new Error(`ECN place order HTTP error: ${response.status}`);
  }

  const responseXml = await response.text();
  console.log(`[ecn] placeOrder response: ${responseXml.substring(0, 500)}`);

  return parseOrderResponse(responseXml);
}

function parseOrderResponse(xml: string): ECNOrderResponse {
  // Check for accepted orders
  const orderSection = xmlText(xml, "order");
  if (orderSection) {
    const orderId = xmlText(orderSection, "orderid");
    const refOrderNumber = xmlText(orderSection, "refordernumber");
    const status = xmlText(orderSection, "status");

    // Check for rejected orders
    const rejectedSection = xmlText(xml, "rejectedorders");
    const rejectedReason = rejectedSection ? xmlText(rejectedSection, "ro_rejectedreason") : "";

    // Check for items not found
    const itemsNotFoundSection = xmlText(xml, "itemsnotfound");
    const itemsNotFound: { sku: string; itemId: string; reason: string }[] = [];
    if (itemsNotFoundSection) {
      const infItems = xmlTextAll(itemsNotFoundSection, "inf_item");
      // Actually, let's parse using the raw section
      const infSku = xmlTextAll(xml, "inf_itemsku");
      const infId = xmlTextAll(xml, "inf_itemid");
      const infReason = xmlTextAll(xml, "inf_rejectedreason");
      for (let i = 0; i < infSku.length; i++) {
        itemsNotFound.push({
          sku: infSku[i] || "",
          itemId: infId[i] || "",
          reason: infReason[i] || "Item not found",
        });
      }
    }

    if (rejectedReason) {
      return {
        success: false,
        orderId,
        refOrderNumber,
        error: rejectedReason,
        itemsNotFound,
      };
    }

    return {
      success: true,
      orderId,
      refOrderNumber,
      status: status || "Submitted",
      itemsNotFound: itemsNotFound.length > 0 ? itemsNotFound : undefined,
    };
  }

  return {
    success: false,
    error: "No order data in ECN response",
  };
}

// --- Order Status ---

/**
 * Check order status. Provide at least one of: orderId, refOrderNumber, or date range.
 */
export async function getOrderStatus(
  credentials: ECNCredentials,
  options: {
    orderId?: string;
    refOrderNumber?: string;
    startDate?: string; // MM/DD/YYYY
    endDate?: string;
  }
): Promise<ECNOrderStatus[]> {
  const url = `${ORDER_BASE}/getxmlorderstatus2.cfm?passkey=${credentials.passkey}&clientID=${credentials.clientId}&storeid=${credentials.clientStoreId}`;

  const statusXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<checkorders>
<order>
<clientid>${escapeXml(credentials.clientId)}</clientid>
<clientstoreid>${escapeXml(credentials.clientStoreId)}</clientstoreid>
<orderid>${escapeXml(options.orderId || "")}</orderid>
<refordernumber>${escapeXml(options.refOrderNumber || "")}</refordernumber>
<orderstartdate>${escapeXml(options.startDate || "")}</orderstartdate>
<orderenddate>${escapeXml(options.endDate || "")}</orderenddate>
</order>
</checkorders>`;

  const formBody = new URLSearchParams();
  formBody.append("getxmlorderstatus", statusXml);

  console.log(`[ecn] getOrderStatus: POST ${url.replace(credentials.passkey, "***")}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  if (!response.ok) {
    throw new Error(`ECN order status HTTP error: ${response.status}`);
  }

  const responseXml = await response.text();
  return parseOrderStatusResponse(responseXml);
}

function parseOrderStatusResponse(xml: string): ECNOrderStatus[] {
  const orders: ECNOrderStatus[] = [];

  // Split on <order> tags within <orders>
  const ordersSection = xmlText(xml, "orders");
  if (!ordersSection) return orders;

  const orderBlocks = ordersSection.split(/<order>/i).slice(1);

  for (const block of orderBlocks) {
    const orderXml = block.split(/<\/order>/i)[0] || "";

    // Parse shipments
    const shipments: ECNShipment[] = [];
    const shipmentBlocks = orderXml.split(/<shipment>/i).slice(1);
    for (const sb of shipmentBlocks) {
      const sXml = sb.split(/<\/shipment>/i)[0] || "";

      // Parse packages within shipment
      const packages: ECNShipmentPackage[] = [];
      const pkgBlocks = sXml.split(/<shipmentpackagesitems>/i).slice(1);
      for (const pb of pkgBlocks) {
        const pXml = pb.split(/<\/shipmentpackagesitems>/i)[0] || "";
        packages.push({
          trackingNumber: xmlText(pXml, "shipmentpackagetrackingnumber"),
          itemSku: xmlText(pXml, "shipmentpackageitemsku"),
          itemQuantity: parseInt(xmlText(pXml, "shipmentpackageitemquantity") || "0", 10),
          itemId: xmlText(pXml, "shipmentpackageitemid"),
          status: xmlText(pXml, "shipmentpackagestatus"),
          weight: xmlText(pXml, "shipmentpackageweight"),
          packageId: xmlText(pXml, "shipmentpackageid"),
        });
      }

      shipments.push({
        shipmentId: xmlText(sXml, "shipmentid"),
        status: xmlText(sXml, "shipmentstatus"),
        carrier: xmlText(sXml, "shipmentcarrier"),
        method: xmlText(sXml, "shipmentmethod"),
        trackingNumber: xmlText(sXml, "shipmenttrackingnumber"),
        date: xmlText(sXml, "shipmentdate") || undefined,
        time: xmlText(sXml, "shipmenttime") || undefined,
        publishedRate: xmlText(sXml, "publishedrate") || undefined,
        packages,
      });
    }

    // Parse line items
    const lineItems: ECNLineItemStatus[] = [];
    const lineItemsSection = xmlText(orderXml, "lineitems");
    if (lineItemsSection) {
      const liBlocks = extractItems(lineItemsSection);
      for (const li of liBlocks) {
        lineItems.push({
          sku: xmlText(li, "sku"),
          itemId: xmlText(li, "itemid"),
          supplier: xmlText(li, "supplier"),
          itemStatus: xmlText(li, "itemstatus"),
          quantity: parseInt(xmlText(li, "quantity") || "0", 10),
          allocated: parseInt(xmlText(li, "allocated") || "0", 10),
          packaged: parseInt(xmlText(li, "packaged") || "0", 10),
          cancelled: parseInt(xmlText(li, "cancelled") || "0", 10),
          backordered: parseInt(xmlText(li, "backordered") || "0", 10),
        });
      }
    }

    // Parse backordered items
    const backorderedItems: { sku: string; itemId: string; quantity: number }[] = [];
    const boSection = xmlText(orderXml, "backordereditems");
    if (boSection) {
      const boBlocks = boSection.split(/<backorderitem>/i).slice(1);
      for (const bo of boBlocks) {
        const boXml = bo.split(/<\/backorderitem>/i)[0] || "";
        backorderedItems.push({
          sku: xmlText(boXml, "backordersku"),
          itemId: xmlText(boXml, "backorderitemid"),
          quantity: parseInt(xmlText(boXml, "backorderquantity") || "0", 10),
        });
      }
    }

    // Parse order actions
    const orderActions: { actionId: string; description: string }[] = [];
    const actionsSection = xmlText(orderXml, "orderactions");
    if (actionsSection) {
      const actionBlocks = actionsSection.split(/<actionitem>/i).slice(1);
      for (const ab of actionBlocks) {
        const aXml = ab.split(/<\/actionitem>/i)[0] || "";
        const actionId = xmlText(aXml, "orderactionid").trim();
        const desc = xmlText(aXml, "orderactiondescription").trim();
        if (actionId) {
          orderActions.push({ actionId, description: desc });
        }
      }
    }

    orders.push({
      orderId: xmlText(orderXml, "orderid"),
      clientId: xmlText(orderXml, "clientid"),
      orderStatus: xmlText(orderXml, "orderstatus"),
      orderPauseStatus: xmlText(orderXml, "orderpausestatus"),
      refOrderNumber: xmlText(orderXml, "refordernumber"),
      orderDate: xmlText(orderXml, "orderdate"),
      orderTime: xmlText(orderXml, "ordertime"),
      shippingMethodId: xmlText(orderXml, "genericshippingmethodid"),
      shipFromLocation: xmlText(orderXml, "shipfromlocation"),
      shipments,
      lineItems,
      backorderedItems,
      orderActions,
    });
  }

  return orders;
}

// --- Order Update (Cancel / Pause / Unpause) ---

/**
 * Cancel, pause, or unpause an order.
 * actionId: 5 = Cancel, 20 = Pause, 22 = Unpause
 * IMPORTANT: Check order status before updating. Only open/non-shipped orders can be updated.
 */
export async function updateOrder(
  credentials: ECNCredentials,
  orderId: string,
  actionId: number
): Promise<{ success: boolean; action?: string; rejectedReason?: string }> {
  const url = `${ORDER_BASE}/processxmlorderupdate.cfm?passkey=${credentials.passkey}&clientID=${credentials.clientId}&storeid=${credentials.clientStoreId}`;

  const updateXml = `<orders>
<order>
<clientid>${escapeXml(credentials.clientId)}</clientid>
<clientstoreid>${escapeXml(credentials.clientStoreId)}</clientstoreid>
<orderid>${escapeXml(orderId)}</orderid>
<orderactionid>${actionId}</orderactionid>
</order>
</orders>`;

  const formBody = new URLSearchParams();
  formBody.append("doxmlorderupdate", updateXml);

  console.log(`[ecn] updateOrder: POST orderId=${orderId} actionId=${actionId}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  if (!response.ok) {
    throw new Error(`ECN order update HTTP error: ${response.status}`);
  }

  const responseXml = await response.text();
  const action = xmlText(responseXml, "orderaction");
  const rejectedReason = xmlText(responseXml, "rejectedreason");

  return {
    success: !rejectedReason,
    action: action || undefined,
    rejectedReason: rejectedReason || undefined,
  };
}

// --- Order Comments ---

/**
 * Add a comment to an order.
 * type: 1 = Tipin, 2 = General Comment
 */
export async function addOrderComment(
  credentials: ECNCredentials,
  orderId: string,
  comment: string,
  type: number = 2
): Promise<boolean> {
  const url = `${ORDER_BASE}/comment.cfm?passkey=${credentials.passkey}&clientID=${credentials.clientId}&storeid=${credentials.clientStoreId}`;

  const formBody = new URLSearchParams();
  formBody.append("comment", `<orders><order><clientstoreid>${credentials.clientStoreId}</clientstoreid><orderid>${orderId}</orderid><comment>${escapeXml(comment)}</comment><type>${type}</type></order></orders>`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  return response.ok;
}

// --- Country Feed ---

export async function fetchCountries(
  credentials: ECNCredentials
): Promise<{ countryId: string; countryName: string; valid: boolean }[]> {
  const url = `${ORDER_BASE}/countryFeed.cfm?passkey=${credentials.passkey}&clientID=${credentials.clientId}&storeid=${credentials.clientStoreId}`;

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`ECN country feed HTTP error: ${response.status}`);
  }

  const xml = await response.text();
  const countries: { countryId: string; countryName: string; valid: boolean }[] = [];

  const countryBlocks = xml.split(/<country>/i).slice(1);
  for (const block of countryBlocks) {
    const cXml = block.split(/<\/country>/i)[0] || "";
    countries.push({
      countryId: xmlText(cXml, "countryid"),
      countryName: xmlText(cXml, "countryname"),
      valid: xmlText(cXml, "valid") === "1" || xmlText(cXml, "valid").toLowerCase() === "true",
    });
  }

  return countries;
}

// --- Validate Credentials ---

/**
 * Test credentials by attempting to fetch the feed.
 * If the feed returns XML, credentials are valid.
 */
export async function validateCredentials(
  credentials: ECNCredentials
): Promise<{ valid: boolean; error?: string }> {
  if (!credentials.clientId || !credentials.clientStoreId || !credentials.passkey) {
    return {
      valid: false,
      error: "All three fields are required: Client ID, Store ID, and Passkey. These are provided by ECN/Adult Drop Shipper.",
    };
  }

  try {
    const url = `${FEED_BASE}/ecnFeed.cfm?act=read&siteID=${credentials.clientStoreId}&passkey=${credentials.passkey}`;

    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        valid: false,
        error: `ECN returned HTTP ${response.status}. Verify your Client ID, Store ID, and Passkey with your ECN rep.`,
      };
    }

    const text = await response.text();
    // A valid response should contain XML content tags
    if (text.includes("<content>") || text.includes("<add>") || text.includes("<?xml")) {
      return { valid: true };
    }

    return {
      valid: false,
      error: "ECN responded but the feed format was unexpected. Contact your ECN rep to confirm your account is active.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timeout") || message.includes("abort")) {
      return {
        valid: false,
        error: "Connection timed out. ECN's feed server may be temporarily unavailable.",
      };
    }
    return { valid: false, error: `Connection failed: ${message}` };
  }
}

// --- XML Escape ---

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
