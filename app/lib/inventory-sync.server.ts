/**
 * IntimaSync Inventory Sync Engine
 *
 * Syncs inventory quantities and prices from all enabled suppliers
 * for products already imported into the Shopify store.
 * Runs daily (via Render cron) or on-demand.
 */
import prisma from "../db.server";
import { decryptCredentials as decryptHP, checkStockBatch } from "./suppliers/honeysplace.server";
import { checkQuantityBatch, getDiscounts, downloadProductFeed } from "./suppliers/eldorado.server";
import { checkInventory } from "./suppliers/nalpac.server";
import { updateDefaultSupplier } from "./order-routing.server";

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Main sync function Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      credMap.set(c.supplier, typeof c.credentialsEncrypted === "string" ? JSON.parse(c.credentialsEncrypted as string) : c.credentialsEncrypted);
    });

    // Ã¢ÂÂÃ¢ÂÂ Honey's Place sync Ã¢ÂÂÃ¢ÂÂ
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

    // Ã¢ÂÂÃ¢ÂÂ Eldorado sync Ã¢ÂÂÃ¢ÂÂ
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

    // Ã¢ÂÂÃ¢ÂÂ Nalpac sync Ã¢ÂÂÃ¢ÂÂ
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

    // Ã¢ÂÂÃ¢ÂÂ Re-evaluate default suppliers based on new prices/stock Ã¢ÂÂÃ¢ÂÂ
    for (const match of matches) {
      if (match.upc) {
        await updateDefaultSupplier(shopId, match.upc).catch(() => {});
      }
    }

    // Ã¢ÂÂÃ¢ÂÂ Push updated inventory to Shopify Ã¢ÂÂÃ¢ÂÂ
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

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Push inventory quantities to Shopify Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ
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
      const variantId = match.shopifyVariantId.replace(
        "gid://shopify/ProductVariant/",
        ""
      );
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
        console.error(
          `Failed to update Shopify variant ${variantId}: ${response.status}`
        );
      }
      // Rate limit handling
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error(
        `Error updating Shopify inventory for variant ${match.shopifyVariantId}:`,
        err
      );
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
      status:
        errors.length === 0
          ? "success"
          : errors.length < processed / 2
          ? "partial"
          : "failed",
      completedAt: new Date(),
      recordsProcessed: processed,
      recordsUpdated: updated,
      errorsJson: errors.length > 0 ? JSON.stringify(errors) : null,
    },
  });
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Product catalog sync (full import from supplier feeds) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// FIX: Unified upsert loop for all three suppliers so HP and Nalpac titles,
// images, and descriptions are actually saved to the database, and
// attemptUpcMatch is called for all suppliers so ProductMatch.honeysplaceSku
// and ProductMatch.nalpacSku get populated.
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

  const creds = typeof credential.credentialsEncrypted === "string" ? JSON.parse(credential.credentialsEncrypted as string) : credential.credentialsEncrypted;

  const log = await prisma.syncLog.create({
    data: { shopId, supplier, syncType: "products", status: "running" },
  });

  try {
    // Normalized product shape Ã¢ÂÂ same interface for all three suppliers
    interface SyncProduct {
      sku: string;
      upc: string | null;
      title: string;
      description: string | null;
      cost: number | null;
      msrp: number | null;
      inventoryQty: number;
      category: string | null;
      manufacturer: string | null;
      images: string[];
    }

    let products: SyncProduct[] = [];

    // Ã¢ÂÂÃ¢ÂÂ Fetch from supplier Ã¢ÂÂÃ¢ÂÂ
    if (supplier === "honeysplace") {
      const { fetchProductFeed, buildFeedUrl } = await import(
        "./suppliers/honeysplace.server"
      );
      const feedUrl = buildFeedUrl(creds);
      const raw = await fetchProductFeed(feedUrl);
      products = raw.map((p) => ({
        sku: p.sku,
        upc: p.upc || null,
        title: p.title,
        description: p.description || null,
        cost: p.cost || null,
        msrp: p.msrp || null,
        inventoryQty: p.inventoryQty ?? 0,
        category: p.category || null,
        manufacturer: p.manufacturer || null,
        images: p.images || [],
      }));
    } else if (supplier === "nalpac") {
      const { fetchProducts } = await import("./suppliers/nalpac.server");
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const batch = await fetchProducts(creds, page, 500);
        for (const p of batch) {
          products.push({
            sku: p.sku,
            upc: p.upc || null,
            title: p.title,
            description: p.description || null,
            cost: p.cost || null,
            msrp: p.msrp || null,
            inventoryQty: p.inventoryQty ?? 0,
            category: p.category || null,
            manufacturer: p.manufacturer || null,
            images: p.images || [],
          });
        }
        hasMore = batch.length === 500;
        page++;
        await new Promise((r) => setTimeout(r, 500));
      }
    } else if (supplier === "eldorado") {
      const eldoProducts = await downloadProductFeed(creds);
      products = eldoProducts.map((p: any) => ({
        sku: p.model,
        upc: p.upc || null,
        title: p.name,
        description: p.description || null,
        cost: p.price || null,
        msrp: p.msrp || null,
        inventoryQty: p.quantity ?? 0,
        category: p.category || null,
        manufacturer: p.manufacturer || null,
        images: p.images || [],
      }));
    }

    // Ã¢ÂÂÃ¢ÂÂ Unified upsert for all suppliers Ã¢ÂÂÃ¢ÂÂ
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
          imagesJson:
            product.images?.length > 0
              ? JSON.stringify(product.images)
              : null,
          isActive: true,
          lastSyncedAt: new Date(),
        };

        if (existing) {
          await prisma.supplierProduct.update({
            where: { id: existing.id },
            data,
          });
          updated++;
        } else {
          await prisma.supplierProduct.create({
            data: { shopId, supplier, supplierSku: product.sku, ...data },
          });
          added++;
        }

        // Auto-match by UPC across all suppliers (was previously Eldorado-only)
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
      data: {
        status: "failed",
        completedAt: new Date(),
        errorsJson: JSON.stringify(errors),
      },
    });
    return { added, updated, errors };
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ UPC-based cross-supplier matching Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ
async function attemptUpcMatch(
  shopId: string,
  upc: string,
  supplier: string,
  sku: string
) {
  const existing = await prisma.productMatch.findFirst({
    where: { shopId, upc },
  });

  const skuField = `${supplier}Sku` as
    | "eldoradoSku"
    | "honeysplaceSku"
    | "nalpacSku";

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
