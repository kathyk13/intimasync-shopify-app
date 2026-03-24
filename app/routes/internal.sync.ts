import { json, type ActionFunctionArgs } from "@remix-run/node";
import { syncProductCatalog } from "../lib/inventory-sync.server";
import prisma from "../db.server";

/**
 * Internal sync endpoint - no Shopify auth required.
 * Secured by SHOPIFY_API_SECRET key in Authorization header.
 * Usage: POST /internal/sync
 *   Header: Authorization: Bearer <SHOPIFY_API_SECRET>  (use the secret, NOT the public API key)
 *   Body: { supplier: "honeysplace" | "nalpac" | "eldorado", shop: "intimasync.myshopify.com" }
 */
export async function action({ request }: ActionFunctionArgs) {
  // Verify secret key
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (token !== process.env.SHOPIFY_API_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const supplier = body.supplier as "honeysplace" | "nalpac" | "eldorado";
  const shopDomain = body.shop || "intimasync.myshopify.com";

  if (!supplier || !["honeysplace", "nalpac", "eldorado"].includes(supplier)) {
    return json({ error: "Invalid supplier. Use: honeysplace, nalpac, or eldorado" }, { status: 400 });
  }

  // Look up the shop ID
  const shop = await prisma.shop.findFirst({ where: { shopifyDomain: shopDomain } });
  if (!shop) {
    return json({ error: "Shop not found: " + shopDomain }, { status: 404 });
  }

  console.log(`[internal-sync] Starting catalog sync: supplier=${supplier} shopId=${shop.id}`);

  const result = await syncProductCatalog(shop.id, supplier);

  console.log(`[internal-sync] Done: added=${result.added} updated=${result.updated} errors=${result.errors.length}`);

  return json({ success: true, supplier, shopId: shop.id, ...result });
}

export async function loader() {
  return json({ status: "ok", message: "POST to this endpoint with Authorization header and { supplier, shop } body" });
}
