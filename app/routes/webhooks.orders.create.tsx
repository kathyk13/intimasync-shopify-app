/**
 * IntimaSync - Shopify Orders/Create Webhook Handler
 * Triggered when a new order is placed in Shopify.
 * Routes order items to the appropriate suppliers.
 */

import { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { routeOrder, type LineItemInput } from "../lib/order-routing.server";
import * as eldorado from "../lib/suppliers/eldorado.server";
import * as honeysplace from "../lib/suppliers/honeysplace.server";
import * as nalpac from "../lib/suppliers/nalpac.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop: shopDomain, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Unexpected topic", { status: 400 });
  }

  const order = payload as any;

  try {
    const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain } });
    if (!shop) {
      console.error(`Shop not found: ${shopDomain}`);
      return new Response("Shop not found", { status: 200 }); // 200 to prevent Shopify retries
    }

    // Build line items
    const lineItems: LineItemInput[] = (order.line_items || []).map((item: any) => ({
      shopifyLineItemId: String(item.id),
      shopifyVariantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      shopifyProductId: `gid://shopify/Product/${item.product_id}`,
      quantity: item.quantity,
      title: item.title,
    }));

    // Route the order
    const { routing, supplierGroups, suppliersUsed } = await routeOrder(
      shop.id,
      String(order.id),
      String(order.order_number || order.name),
      lineItems
    );

    if (supplierGroups.length === 0) {
      console.log(`Order ${order.order_number}: No managed products found, skipping.`);
      return new Response("OK", { status: 200 });
    }

    // Get credentials
    const credentials = await prisma.supplierCredential.findMany({
      where: { shopId: shop.id, enabled: true },
    });
    const credMap = new Map<string, any>();
    credentials.forEach((c) => {
      credMap.set(c.supplier, { creds: JSON.parse(c.credentialsEncrypted), shippingCode: c.defaultShippingCode });
    });

    // Submit to each supplier
    const orderDate = new Date(order.created_at);
    const dateStr = `${String(orderDate.getMonth() + 1).padStart(2, "0")}/${String(orderDate.getDate()).padStart(2, "0")}/${String(orderDate.getFullYear()).slice(-2)}`;

    const shipping = order.shipping_address || order.billing_address || {};
    const customerName = `${shipping.first_name || ""} ${shipping.last_name || ""}`.trim().substring(0, 25);

    for (const group of supplierGroups) {
      const supplierCred = credMap.get(group.supplier);
      if (!supplierCred) {
        console.error(`No credentials for supplier: ${group.supplier}`);
        continue;
      }

      const { creds, shippingCode } = supplierCred;
      const sourceOrderNum = String(order.id).slice(-10); // Max 10 digits for Eldorado

      try {
        if (group.supplier === "honeysplace") {
          const result = await honeysplace.submitOrder(creds, {
            reference: `ORDER${sourceOrderNum}`,
            shipBy: shippingCode || "RTSHOP",
            date: dateStr,
            items: group.items.map((item) => ({
              sku: item.supplierSku,
              qty: item.qty,
            })),
          });

          // Update routing status
          await updateLineRoutingStatus(
            shop.id,
            String(order.id),
            group.items.map((i) => i.lineItemId),
            result.code === "100" ? "submitted" : "error",
            result.reference
          );

          if (result.code !== "100") {
            console.error(`Honey's Place order error: ${result.message}`);
          }
        } else if (group.supplier === "eldorado") {
          const result = await eldorado.placeOrder(
            creds,
            {
              sourceOrderNumber: sourceOrderNum,
              name: customerName,
              addressLine1: (shipping.address1 || "").substring(0, 30),
              addressLine2: shipping.address2 ? shipping.address2.substring(0, 25) : undefined,
              city: (shipping.city || "").substring(0, 15),
              stateCode: (shipping.province_code || shipping.province || "").substring(0, 2),
              zipCode: (shipping.zip || "").substring(0, 10),
              countryCode: (shipping.country_code || "US").substring(0, 2),
              phoneNumber: (order.phone || "0000000000").replace(/\D/g, "").substring(0, 20),
              shipVia: shippingCode || "B2CBR",
              products: group.items.map((item) => ({
                code: item.supplierSku,
                quantity: item.qty,
              })),
            }
          );

          await updateLineRoutingStatus(
            shop.id,
            String(order.id),
            group.items.map((i) => i.lineItemId),
            result.success ? "submitted" : "error",
            result.filename  // Eldorado order ref is the uploaded XML filename
          );

          if (!result.success) {
            console.error(`Eldorado order error: ${result.error}`);
          }
        } else if (group.supplier === "nalpac") {
          const result = await nalpac.placeOrder(creds, {
            poNumber: `ORDER${sourceOrderNum}`,
            shippingMethod: shippingCode || "BESTWAY",
            shipToName: customerName,
            shipToAddress1: shipping.address1 || "",
            shipToAddress2: shipping.address2 || undefined,
            shipToCity: shipping.city || "",
            shipToState: shipping.province_code || shipping.province || "",
            shipToZip: shipping.zip || "",
            shipToCountry: shipping.country_code || "US",
            shipToPhone: (order.phone || "").replace(/\D/g, "") || "0000000000",
            items: group.items.map((item) => ({
              itemNumber: item.supplierSku,
              quantity: item.qty,
            })),
          });

          await updateLineRoutingStatus(
            shop.id,
            String(order.id),
            group.items.map((i) => i.lineItemId),
            result.success ? "submitted" : "error",
            result.orderId
          );

          if (!result.success) {
            console.error(`Nalpac order error: ${result.error}`);
          }
        }
      } catch (err) {
        console.error(`Error submitting order to ${group.supplier}:`, err);
        await updateLineRoutingStatus(
          shop.id,
          String(order.id),
          group.items.map((i) => i.lineItemId),
          "error"
        );
      }
    }

    // Add order note to Shopify with routing info
    await addOrderNote(shop, String(order.id), supplierGroups, suppliersUsed);

    console.log(`Order ${order.order_number} routed to ${suppliersUsed} supplier(s).`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Internal error", { status: 500 });
  }
};

async function updateLineRoutingStatus(
  shopId: string,
  shopifyOrderId: string,
  lineItemIds: string[],
  status: string,
  supplierRef?: string
) {
  const orderRouting = await prisma.orderRouting.findFirst({
    where: { shopId, shopifyOrderId },
  });
  if (!orderRouting) return;

  await prisma.orderLineRouting.updateMany({
    where: {
      orderRoutingId: orderRouting.id,
      shopifyLineItemId: { in: lineItemIds },
    },
    data: {
      status,
      ...(supplierRef ? { supplierOrderRef: supplierRef } : {}),
    },
  });
}

async function addOrderNote(
  shop: any,
  orderId: string,
  groups: any[],
  supplierCount: number
) {
  const noteLines = [
    `[IntimaSync] Routed to ${supplierCount} supplier(s):`,
    ...groups.map((g) => `- ${g.supplier}: ${g.items.length} item(s) ($${g.totalCost.toFixed(2)})`),
  ];

  try {
    await fetch(`https://${shop.shopifyDomain}/admin/api/2024-10/orders/${orderId}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": shop.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order: {
          id: parseInt(orderId),
          note: noteLines.join("\n"),
        },
      }),
    });
  } catch (err) {
    console.error("Failed to add order note:", err);
  }
}
