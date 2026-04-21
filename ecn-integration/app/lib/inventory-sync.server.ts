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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Main sync function ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
function decodeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 10)));
}

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

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Honey's Place sync ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Eldorado sync ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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
          const errMsg = String(err);
          // "No inventory CSV" is expected for new accounts - Eldorado generates
          // these files on a schedule. Treat as a warning, not a hard failure.
          if (errMsg.includes("No inventory CSV")) {
            console.warn(`[inventory-sync] Eldorado: ${errMsg} (this is normal for new accounts)`);
            errors.push(`Eldorado: inventory files not yet available (new account - check back in 24-48h)`);
          } else {
            errors.push(`Eldorado sync error: ${err}`);
          }
        }
      }
    }

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Nalpac sync ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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

    // ── ECN sync ──
    if (credMap.has("ecn")) {
      const ecnCreds = credMap.get("ecn");
      const ecnSkus = matches
        .filter((m) => m.ecnSku)
        .map((m) => m.ecnSku!);
      if (ecnSkus.length > 0) {
        try {
          const { fetchFeed, updateSyncDate } = await import("./suppliers/ecn.server");
          const feed = await fetchFeed(ecnCreds);
          // Build a map of itemId -> quantity from the differential feed
          const stockMap = new Map<string, number>();
          for (const product of [...feed.add, ...feed.modify]) {
            if (product.itemId && product.inventoryQty !== undefined) {
              stockMap.set(product.itemId, product.inventoryQty);
            }
          }
          // Mark deleted items as 0 stock
          for (const product of feed.delete) {
            if (product.itemId) {
              stockMap.set(product.itemId, 0);
            }
          }
          for (const [sku, qty] of stockMap) {
            if (!ecnSkus.includes(sku)) continue;
            await prisma.supplierProduct.updateMany({
              where: { shopId, supplier: "ecn", supplierSku: sku },
              data: { inventoryQty: qty, lastSyncedAt: new Date() },
            });
            updated++;
          }
          // Advance ECN differential marker so next fetch only returns new changes
          await updateSyncDate(ecnCreds).catch((err: any) =>
            console.warn(`[inventory-sync] ECN updateSyncDate failed: ${err}`)
          );
        } catch (err) {
          errors.push(`ECN sync error: ${err}`);
        }
      }
    }

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Re-evaluate default suppliers based on new prices/stock ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
    for (const match of matches) {
      if (match.upc) {
        await updateDefaultSupplier(shopId, match.upc).catch(() => {});
      }
    }

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Push updated inventory to Shopify ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Push inventory quantities to Shopify ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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

    for (const supplier of ["eldorado", "honeysplace", "nalpac", "ecn"]) {
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
  // Determine status: if we updated anything, it's at least partial success
  let status: string;
  if (errors.length === 0) {
    status = "success";
  } else if (updated > 0) {
    // Some items were updated despite errors (e.g. one supplier failed but others worked)
    status = "partial";
  } else if (processed === 0 && errors.length > 0) {
    status = "failed";
  } else {
    status = "failed";
  }

  await prisma.syncLog.update({
    where: { id: logId },
    data: {
      status,
      completedAt: new Date(),
      recordsProcessed: processed,
      recordsUpdated: updated,
      errorsJson: errors.length > 0 ? JSON.stringify(errors) : null,
    },
  });
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Product catalog sync (full import from supplier feeds) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// FIX: Unified upsert loop for all three suppliers so HP and Nalpac titles,
// images, and descriptions are actually saved to the database, and
// attemptUpcMatch is called for all suppliers so ProductMatch.honeysplaceSku
// and ProductMatch.nalpacSku get populated.
export async function syncProductCatalog(
  shopId: string,
  supplier: "honeysplace" | "eldorado" | "nalpac" | "ecn"
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

  // Clean up ALL stale "running" logs (any supplier) older than 10 min
  // This catches logs from before the fire-and-forget fix that got stuck
  const tenMinAgo = new Date(Date.now() - 10 * 60_000);
  await prisma.syncLog.updateMany({
    where: { shopId, status: "running", startedAt: { lt: tenMinAgo } },
    data: { status: "failed", completedAt: new Date(), errorsJson: JSON.stringify(["Timed out or crashed"]) },
  });

  const log = await prisma.syncLog.create({
    data: { shopId, supplier, syncType: "products", status: "running" },
  });

  try {
    // Normalized product shape ÃÂ¢ÃÂÃÂ same interface for all three suppliers
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

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Fetch from supplier ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
    if (supplier === "honeysplace") {
      const { fetchProductFeed, buildFeedUrl } = await import(
        "./suppliers/honeysplace.server"
      );
      const feedUrl = buildFeedUrl(creds);
      console.log(`[honeysplace] syncProductCatalog: fetching feed from ${feedUrl.substring(0, 60)}...`);
      const raw = await fetchProductFeed(feedUrl);
      console.log(`[honeysplace] syncProductCatalog: received ${raw.length} products from feed`);
      const hpWithImages = raw.filter((p) => p.images?.length > 0);
      console.log(`[honeysplace] products with images: ${hpWithImages.length}/${raw.length}`);
      if (hpWithImages.length > 0) console.log(`[honeysplace] sample image URL: ${hpWithImages[0].images[0]}`);
      products = raw.map((p) => ({
        sku: p.sku,
        upc: p.upc || null,
        title: decodeHtml(p.title),
        description: decodeHtml(p.description) || null,
        cost: p.cost ? parseFloat(String(p.cost)) || null : null,
        msrp: p.msrp ? parseFloat(String(p.msrp)) || null : null,
        inventoryQty: p.inventoryQty ?? 0,
        category: p.category || null,
        manufacturer: p.manufacturer || null,
        images: p.images || [],
      }));
    } else if (supplier === "nalpac") {
      const { fetchProducts } = await import("./suppliers/nalpac.server");
      // Nalpac API caps pages at 100 items regardless of requested pageSize.
      // Use pageSize=100 and loop until we get a short page.
      const PAGE_SIZE = 100;
      const MAX_PAGES = 250; // safety: 250 pages * 100 = 25,000 max
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= MAX_PAGES) {
        console.log(`[nalpac] syncProductCatalog: fetching page ${page} (pageSize=${PAGE_SIZE})`);
        const batch = await fetchProducts(creds, page, PAGE_SIZE);
        console.log(`[nalpac] syncProductCatalog: page ${page} returned ${batch.length} items (total so far: ${products.length + batch.length})`);
        for (const p of batch) {
          products.push({
            sku: p.sku,
            upc: p.upc || null,
            title: decodeHtml(p.title),
            description: decodeHtml(p.description) || null,
            cost: p.cost ? parseFloat(String(p.cost)) || null : null,
            msrp: p.msrp ? parseFloat(String(p.msrp)) || null : null,
            inventoryQty: p.inventoryQty ?? 0,
            category: p.category || null,
            manufacturer: p.manufacturer || null,
            images: p.images || [],
          });
        }
        // Stop when a page returns fewer items than requested (last page)
        hasMore = batch.length >= PAGE_SIZE;
        page++;
        // Small delay to avoid rate-limiting
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log(`[nalpac] syncProductCatalog: finished — ${products.length} total products fetched over ${page - 1} pages`);
      const withImages = products.filter((p: any) => p.images?.length > 0);
      console.log(`[nalpac] products with images: ${withImages.length}/${products.length}`);
      if (withImages.length > 0) console.log(`[nalpac] sample image URL: ${withImages[0].images[0]}`);
    } else if (supplier === "eldorado") {
      const eldoProducts = await downloadProductFeed(creds);
      products = eldoProducts.map((p: any) => ({
        sku: p.model,
        upc: p.upc || null,
        title: decodeHtml(p.name),
        description: decodeHtml(p.description) || null,
        cost: p.price ? parseFloat(String(p.price)) || null : null,
        msrp: p.msrp ? parseFloat(String(p.msrp)) || null : null,
        inventoryQty: p.quantity ?? 0,
        category: p.category || null,
        manufacturer: p.manufacturer || null,
        images: p.images || [],
      }));
      const eldWithImages = products.filter((p: any) => p.images?.length > 0);
      console.log(`[eldorado] products with images: ${eldWithImages.length}/${products.length}`);
      if (eldWithImages.length > 0) console.log(`[eldorado] sample image URL: ${eldWithImages[0].images[0]}`);
    } else if (supplier === "ecn") {
      const { fetchFeed, updateSyncDate, buildImageUrl } = await import("./suppliers/ecn.server");
      console.log(`[ecn] syncProductCatalog: fetching differential feed...`);
      const feed = await fetchFeed(creds);
      const allProducts = [...feed.add, ...feed.modify];
      console.log(`[ecn] syncProductCatalog: received ${allProducts.length} products (add: ${feed.add.length}, modify: ${feed.modify.length}, delete: ${feed.delete.length})`);
      products = allProducts.map((p) => ({
        sku: p.itemId,
        upc: p.upc || null,
        title: decodeHtml(p.title),
        description: p.description || null,
        cost: p.cost != null ? parseFloat(String(p.cost)) || null : null,
        msrp: p.msrp != null ? parseFloat(String(p.msrp)) || null : null,
        inventoryQty: p.inventoryQty ?? 0,
        category: p.category || null,
        manufacturer: p.manufacturer || null,
        images: p.itemId ? [buildImageUrl(p.itemId, 1), buildImageUrl(p.itemId, 2)] : [],
      }));
      // Mark deleted items as inactive (handled separately after upsert loop)
      if (feed.delete.length > 0) {
        console.log(`[ecn] marking ${feed.delete.length} deleted items as inactive`);
        for (const del of feed.delete) {
          if (del.itemId) {
            await prisma.supplierProduct.updateMany({
              where: { shopId, supplier: "ecn", supplierSku: del.itemId },
              data: { isActive: false, inventoryQty: 0, lastSyncedAt: new Date() },
            });
          }
        }
      }
      // Advance ECN's differential marker
      await updateSyncDate(creds).catch((err: any) =>
        console.warn(`[ecn] updateSyncDate failed: ${err}`)
      );
      const ecnWithImages = products.filter((p: any) => p.images?.length > 0);
      console.log(`[ecn] products with images: ${ecnWithImages.length}/${products.length}`);
    }

    // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Unified upsert for all suppliers ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
    console.log(`[${supplier}] syncProductCatalog: upserting ${products.length} products into database...`);
    let upsertCount = 0;
    for (const product of products) {
      try {
        const existing = await prisma.supplierProduct.findFirst({
          where: { shopId, supplier, supplierSku: product.sku },
        });

        const data = {
          upc: product.upc || null,
          title: product.title,
          description: product.description || null,
          msrp: product.msrp != null ? parseFloat(String(product.msrp)) || null : null,
          cost: product.cost != null ? parseFloat(String(product.cost)) || null : null,
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
        upsertCount++;
        if (upsertCount % 1000 === 0) {
          console.log(`[${supplier}] syncProductCatalog: upserted ${upsertCount}/${products.length}`);
        }
      } catch (err) {
        errors.push(`SKU ${product.sku}: ${err}`);
        upsertCount++;
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ UPC-based cross-supplier matching ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
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
    | "nalpacSku"
    | "ecnSku";

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
