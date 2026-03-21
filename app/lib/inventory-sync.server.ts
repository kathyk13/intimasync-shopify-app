/**
 * IntimaSync Inventory Sync Engine
 *
 * Syncs inventory quantities and prices from all enabled suppliers
 * for products already imported into the Shopify store.
 * Runs daily (via Render cron) or on-demand.
 */

import prisma from "../db.server";
import { decryptCredentials as decryptHP, checkStockBatch } from "./suppliers/honeysplace.server";
import { checkQuantityBatch, getDiscounts } from "./suppliers/eldorado.server";
import { checkInventory } from "./suppliers/nalpac.server";
import { updateDefaultSupplier } from "./order-routing.server";

// ─── Main sync function ───

export async function runInventorySync(shopId: string): Promise<{
  success: boolean;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let updated = 0;

  const log = await prisma.syncLog.create({
    data: {
      shopId,
      supplier: "all",
      syncType: "inventory",
      status: "running",
    },
  });

  try {
    // Get all product matches for this shop (only synced products)
    const matches = await prisma.productMatch.findMany({
      where: { shopId, shopifyProductId: { not: null } },
    });

    if (matches.length === 0) {
      await completeSyncLog(log.id, 0, 0, []);
      return { success: true, updated: 0, errors: [] };
    }

    // Get enabled supplier credentials
    const credentials = await prisma.supplierCredential.findMany({
      where: { shopId, enabled: true },
    });

    const credMap = new Map<string, any>();
    credentials.forEach((c) => {
      credMap.set(c.supplier, JSON.parse(c.credentialsEncrypted));
    });

    // ── Honey's Place sync ──
    if (credMap.has("honeysplace")) {
      const hpCreds = decryptHP(credMap.get("honeysplace")!);
      const hpSkus = matches
        .filter((m) => m.honeysplaceSku)
        .map((m) => m.honeysplaceSku!);

      if (hpSkus.length > 0) {
        try {
          const stockMap = await checkStockBatch(hpCreds, hpSkus);
          for (const [sku, qty] of stockMap) {
            await prisma.supplierProduct.updateMany({
              where: { shopId, supplier: "honeysplace", supplierSku: sku },
              data: { inventoryQty: qty, lastSyncedAt: new Date() },
            });
            updated++;
          }
        } catch (err) {
          errors.push(`Honey's Place sync error: ${err}`);
        }
      }
    }

    // ── Eldorado sync ──
    if (credMap.has("eldorado")) {
      const eldCreds = credMap.get("eldorado");
      const eldModels = matches
        .filter((m) => m.eldoradoSku)
        .map((m) => m.eldoradoSku!);

      if (eldModels.length > 0) {
        try {
          const qtyMap = await checkQuantityBatch(eldCreds, eldModels);

          // Also fetch discount information
          let discounts = new Map<string, number>();
          try {
            discounts = await getDiscounts(eldCreds);
          } catch (_) {
            // Discounts are optional
          }

          for (const [model, qty] of qtyMap) {
            const discountPct = discounts.get(model) || 0;
            const product = await prisma.supplierProduct.findFirst({
              where: { shopId, supplier: "eldorado", supplierSku: model },
            });
            if (product) {
              const discountedCost = product.cost
                ? product.cost * (1 - discountPct / 100)
                : product.cost;
              await prisma.supplierProduct.update({
                where: { id: product.id },
                data: {
                  inventoryQty: qty,
                  cost: discountedCost,
                  lastSyncedAt: new Date(),
                },
              });
              updated++;
            }
          }
        } catch (err) {
          errors.push(`Eldorado sync error: ${err}`);
        }
      }
    }

    // ── Nalpac sync ──
    if (credMap.has("nalpac")) {
      const nalpacCreds = credMap.get("nalpac");
      const nalpacSkus = matches
        .filter((m) => m.nalpacSku)
        .map((m) => m.nalpacSku!);

      if (nalpacSkus.length > 0) {
        try {
          const stockMap = await checkInventory(nalpacCreds, nalpacSkus);
          for (const [sku, qty] of stockMap) {
            await prisma.supplierProduct.updateMany({
              where: { shopId, supplier: "nalpac", supplierSku: sku },
              data: { inventoryQty: qty, lastSyncedAt: new Date() },
            });
            updated++;
          }
        } catch (err) {
          errors.push(`Nalpac sync error: ${err}`);
        }
      }
    }

    // ── Re-evaluate default suppliers based on new prices/stock ──
    for (const match of matches) {
      if (match.upc) {
        await updateDefaultSupplier(shopId, match.upc).catch(() => {});
      }
    }

    // ── Push updated inventory to Shopify ──
    await pushInventoryToShopify(shopId, matches, credMap);

    await completeSyncLog(log.id, matches.length, updated, errors);
    return { success: true, updated, errors };
  } catch (err) {
    const errMsg = String(err);
    errors.push(errMsg);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "failed", completedAt: new Date(), errorsJson: JSON.stringify(errors) },
    });
    return { success: false, updated, errors };
  }
}

// ─── Push inventory quantities to Shopify ───

async function pushInventoryToShopify(
  shopId: string,
  matches: any[],
  credMap: Map<string, any>
) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;

  for (const match of matches) {
    if (!match.shopifyVariantId) continue;

    // Sum available inventory across all active suppliers
    let totalQty = 0;
    const supplierData: { [key: string]: number } = {};

    for (const supplier of ["eldorado", "honeysplace", "nalpac"]) {
      const sku = match[`${supplier}Sku`];
      if (!sku) continue;
      const product = await prisma.supplierProduct.findFirst({
        where: { shopId, supplier, supplierSku: sku },
      });
      if (product) {
        supplierData[supplier] = product.inventoryQty;
        totalQty += product.inventoryQty;
      }
    }

    // Update Shopify inventory via Admin API
    try {
      const variantId = match.shopifyVariantId.replace("gid://shopify/ProductVariant/", "");
      const response = await fetch(
        `https://${shop.shopifyDomain}/admin/api/2024-10/variants/${variantId}.json`,
        {
          method: "PUT",
          headers: {
            "X-Shopify-Access-Token": shop.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            variant: {
              id: parseInt(variantId),
              inventory_quantity: totalQty,
              inventory_management: "shopify",
            },
          }),
        }
      );

      if (!response.ok && response.status !== 429) {
        console.error(`Failed to update Shopify variant ${variantId}: ${response.status}`);
      }

      // Rate limit handling
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(`Error updating Shopify inventory for variant ${match.shopifyVariantId}:`, err);
    }
  }
}

async function completeSyncLog(
  logId: string,
  processed: number,
  updated: number,
  errors: string[]
) {
  await prisma.syncLog.update({
    where: { id: logId },
    data: {
      status: errors.length === 0 ? "success" : errors.length < processed / 2 ? "partial" : "failed",
      completedAt: new Date(),
      recordsProcessed: processed,
      recordsUpdated: updated,
      errorsJson: errors.length > 0 ? JSON.stringify(errors) : null,
    },
  });
}

// ─── Product catalog sync (full import from supplier feeds) ───

export async function syncProductCatalog(
  shopId: string,
  supplier: "honeysplace" | "eldorado" | "nalpac"
): Promise<{ added: number; updated: number; errors: string[] }> {
  const errors: string[] = [];
  let added = 0;
  let updated = 0;

  const credential = await prisma.supplierCredential.findUnique({
    where: { shopId_supplier: { shopId, supplier } },
  });
  if (!credential?.enabled) {
    return { added: 0, updated: 0, errors: ["Supplier not enabled"] };
  }

  const creds = JSON.parse(credential.credentialsEncrypted);

  const log = await prisma.syncLog.create({
    data: { shopId, supplier, syncType: "products", status: "running" },
  });

  try {
    let products: any[] = [];

    if (supplier === "honeysplace") {
      const { fetchProductFeed } = await import("./suppliers/honeysplace.server");
      const feedUrl = creds.feedUrl || `https://www.honeysplace.com/df/${creds.feedToken}/json`;
      products = await fetchProductFeed(feedUrl);
    } else if (supplier === "nalpac") {
      const { fetchProducts } = await import("./suppliers/nalpac.server");
      // Fetch all pages
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const batch = await fetchProducts(creds, page, 500);
        products.push(...batch);
        hasMore = batch.length === 500;
        page++;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    // Eldorado is handled via SFTP - see syncEldoradoCatalogFromSftp()

    for (const product of products) {
      try {
        const existing = await prisma.supplierProduct.findFirst({
          where: { shopId, supplier, supplierSku: product.sku },
        });

        const data = {
          upc: product.upc || null,
          title: product.title,
          description: product.description || null,
          msrp: product.msrp || null,
          cost: product.cost || null,
          inventoryQty: product.inventoryQty || 0,
          category: product.category || null,
          manufacturer: product.manufacturer || null,
          imagesJson: product.images?.length > 0 ? JSON.stringify(product.images) : null,
          isActive: true,
          lastSyncedAt: new Date(),
        };

        if (existing) {
          await prisma.supplierProduct.update({ where: { id: existing.id }, data });
          updated++;
        } else {
          await prisma.supplierProduct.create({
            data: { shopId, supplier, supplierSku: product.sku, ...data },
          });
          added++;
        }

        // Auto-match by UPC if possible
        if (product.upc) {
          await attemptUpcMatch(shopId, product.upc, supplier, product.sku);
        }
      } catch (err) {
        errors.push(`SKU ${product.sku}: ${err}`);
      }
    }

    await completeSyncLog(log.id, products.length, added + updated, errors);
    return { added, updated, errors };
  } catch (err) {
    errors.push(String(err));
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "failed", completedAt: new Date(), errorsJson: JSON.stringify(errors) },
    });
    return { added, updated, errors };
  }
}

// ─── UPC-based cross-supplier matching ───

async function attemptUpcMatch(
  shopId: string,
  upc: string,
  supplier: string,
  sku: string
) {
  const existing = await prisma.productMatch.findFirst({
    where: { shopId, upc },
  });

  const skuField = `${supplier}Sku` as "eldoradoSku" | "honeysplaceSku" | "nalpacSku";

  if (existing) {
    // Update the matching SKU for this supplier
    await prisma.productMatch.update({
      where: { id: existing.id },
      data: { [skuField]: sku },
    });
  } else {
    // Create a new match entry
    await prisma.productMatch.create({
      data: {
        shopId,
        upc,
        [skuField]: sku,
        defaultSupplier: supplier,
      },
    });
  }
}
