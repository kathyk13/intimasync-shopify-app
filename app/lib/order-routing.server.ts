/**
 * IntimaSync Order Routing Engine
 *
 * Logic: Given a Shopify order, assign each line item to the cheapest
 * available supplier, while minimizing the total number of suppliers
 * (target: <= 2 suppliers per order to reduce dropship fees).
 */

import prisma from "../db.server";

export interface LineItemInput {
  shopifyLineItemId: string;
  shopifyVariantId: string;
  shopifyProductId: string;
  quantity: number;
  title: string;
}

export interface RoutingDecision {
  supplier: string;
  supplierSku: string;
  qty: number;
  unitCost: number;
  isLocked: boolean;
}

export interface OrderRoutingResult {
  [lineItemId: string]: RoutingDecision;
}

export interface SupplierGroup {
  supplier: string;
  items: {
    lineItemId: string;
    supplierSku: string;
    qty: number;
    cost: number;
  }[];
  totalCost: number;
}

// ─── Main routing function ───

export async function routeOrder(
  shopId: string,
  orderId: string,
  orderNumber: string,
  lineItems: LineItemInput[]
): Promise<{
  routing: OrderRoutingResult;
  supplierGroups: SupplierGroup[];
  suppliersUsed: number;
}> {
  const routing: OrderRoutingResult = {};

  // Step 1: For each line item, find its product match and determine cheapest supplier
  for (const item of lineItems) {
    const match = await prisma.productMatch.findFirst({
      where: {
        shopId,
        OR: [
          { shopifyProductId: item.shopifyProductId },
          { shopifyVariantId: item.shopifyVariantId },
        ],
      },
    });

    if (!match) continue; // Not a managed product, skip

    // If supplier is manually locked, use that
    if (match.lockedSupplier) {
      const supplierSku = getSupplierSku(match, match.lockedSupplier);
      const cost = await getSupplierCost(shopId, match.lockedSupplier, supplierSku || "");
      routing[item.shopifyLineItemId] = {
        supplier: match.lockedSupplier,
        supplierSku: supplierSku || "",
        qty: item.quantity,
        unitCost: cost,
        isLocked: true,
      };
      continue;
    }

    // Otherwise, find the cheapest supplier with stock
    const cheapest = await findCheapestSupplier(shopId, match, item.quantity);
    if (cheapest) {
      routing[item.shopifyLineItemId] = {
        supplier: cheapest.supplier,
        supplierSku: cheapest.sku,
        qty: item.quantity,
        unitCost: cheapest.cost,
        isLocked: false,
      };
    }
  }

  // Step 2: Try to consolidate to <= 2 suppliers
  const consolidated = await consolidateSuppliers(shopId, routing, lineItems, 2);

  // Step 3: Group by supplier for order submission
  const supplierGroups = groupBySupplier(consolidated);

  // Step 4: Save routing to database
  await saveRouting(shopId, orderId, orderNumber, consolidated, supplierGroups);

  return {
    routing: consolidated,
    supplierGroups,
    suppliersUsed: supplierGroups.length,
  };
}

// ─── Find cheapest supplier for a product ───

async function findCheapestSupplier(
  shopId: string,
  match: any,
  qtyNeeded: number
): Promise<{ supplier: string; sku: string; cost: number } | null> {
  const candidates: { supplier: string; sku: string; cost: number; qty: number }[] = [];

  const supplierSkuPairs: [string, string | null][] = [
    ["eldorado", match.eldoradoSku],
    ["honeysplace", match.honeysplaceSku],
    ["nalpac", match.nalpacSku],
  ];

  for (const [supplier, sku] of supplierSkuPairs) {
    if (!sku) continue;
    const product = await prisma.supplierProduct.findFirst({
      where: { shopId, supplier, supplierSku: sku },
    });
    if (!product || product.inventoryQty < qtyNeeded) continue;
    if (product.cost === null || product.cost === undefined) continue;
    candidates.push({
      supplier,
      sku,
      cost: product.cost,
      qty: product.inventoryQty,
    });
  }

  if (candidates.length === 0) return null;

  // Sort by cost ascending
  candidates.sort((a, b) => a.cost - b.cost);
  const best = candidates[0];
  return { supplier: best.supplier, sku: best.sku, cost: best.cost };
}

// ─── Consolidate to max N suppliers ───

async function consolidateSuppliers(
  shopId: string,
  routing: OrderRoutingResult,
  lineItems: LineItemInput[],
  maxSuppliers: number
): Promise<OrderRoutingResult> {
  const supplierCounts = new Map<string, number>();
  for (const decision of Object.values(routing)) {
    supplierCounts.set(
      decision.supplier,
      (supplierCounts.get(decision.supplier) || 0) + 1
    );
  }

  const uniqueSuppliers = [...supplierCounts.keys()];
  if (uniqueSuppliers.length <= maxSuppliers) {
    return routing; // Already within limit
  }

  // Find the dominant supplier (most items)
  uniqueSuppliers.sort(
    (a, b) => (supplierCounts.get(b) || 0) - (supplierCounts.get(a) || 0)
  );
  const primarySupplier = uniqueSuppliers[0];
  const secondarySupplier = uniqueSuppliers[1];

  // Try to move items from 3rd+ suppliers to primary or secondary
  const result = { ...routing };
  for (const [lineItemId, decision] of Object.entries(result)) {
    if (decision.supplier !== primarySupplier && decision.supplier !== secondarySupplier) {
      if (decision.isLocked) continue; // Cannot override locked suppliers

      const item = lineItems.find((l) => l.shopifyLineItemId === lineItemId);
      if (!item) continue;

      const match = await prisma.productMatch.findFirst({
        where: {
          shopId,
          OR: [
            { shopifyProductId: item.shopifyProductId },
            { shopifyVariantId: item.shopifyVariantId },
          ],
        },
      });
      if (!match) continue;

      // Try primary supplier first
      const primarySku = getSupplierSku(match, primarySupplier);
      if (primarySku) {
        const product = await prisma.supplierProduct.findFirst({
          where: { shopId, supplier: primarySupplier, supplierSku: primarySku },
        });
        if (product && product.inventoryQty >= item.quantity) {
          result[lineItemId] = {
            supplier: primarySupplier,
            supplierSku: primarySku,
            qty: item.quantity,
            unitCost: product.cost || 0,
            isLocked: false,
          };
          continue;
        }
      }

      // Try secondary supplier
      const secondarySku = getSupplierSku(match, secondarySupplier);
      if (secondarySku) {
        const product = await prisma.supplierProduct.findFirst({
          where: { shopId, supplier: secondarySupplier, supplierSku: secondarySku },
        });
        if (product && product.inventoryQty >= item.quantity) {
          result[lineItemId] = {
            supplier: secondarySupplier,
            supplierSku: secondarySku,
            qty: item.quantity,
            unitCost: product.cost || 0,
            isLocked: false,
          };
        }
      }
    }
  }

  return result;
}

// ─── Helpers ───

function getSupplierSku(match: any, supplier: string): string | null {
  const skuMap: Record<string, string | null> = {
    eldorado: match.eldoradoSku,
    honeysplace: match.honeysplaceSku,
    nalpac: match.nalpacSku,
  };
  return skuMap[supplier] || null;
}

async function getSupplierCost(
  shopId: string,
  supplier: string,
  sku: string
): Promise<number> {
  const product = await prisma.supplierProduct.findFirst({
    where: { shopId, supplier, supplierSku: sku },
  });
  return product?.cost || 0;
}

function groupBySupplier(routing: OrderRoutingResult): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const [lineItemId, decision] of Object.entries(routing)) {
    if (!groups.has(decision.supplier)) {
      groups.set(decision.supplier, {
        supplier: decision.supplier,
        items: [],
        totalCost: 0,
      });
    }
    const group = groups.get(decision.supplier)!;
    group.items.push({
      lineItemId,
      supplierSku: decision.supplierSku,
      qty: decision.qty,
      cost: decision.unitCost,
    });
    group.totalCost += decision.unitCost * decision.qty;
  }
  return [...groups.values()];
}

async function saveRouting(
  shopId: string,
  orderId: string,
  orderNumber: string,
  routing: OrderRoutingResult,
  groups: SupplierGroup[]
) {
  const orderRouting = await prisma.orderRouting.upsert({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId: orderId } },
    create: {
      shopId,
      shopifyOrderId: orderId,
      shopifyOrderNumber: orderNumber,
      routingJson: JSON.stringify({ routing, groups }),
      status: "routed",
    },
    update: {
      routingJson: JSON.stringify({ routing, groups }),
      status: "routed",
    },
  });

  // Create or update line routing records
  for (const [lineItemId, decision] of Object.entries(routing)) {
    await prisma.orderLineRouting.upsert({
      where: {
        id: `${orderRouting.id}-${lineItemId}`, // not a real unique key; handle differently
      },
      create: {
        orderRoutingId: orderRouting.id,
        shopifyLineItemId: lineItemId,
        supplier: decision.supplier,
        supplierSku: decision.supplierSku,
        qty: decision.qty,
        status: "pending",
      },
      update: {
        supplier: decision.supplier,
        supplierSku: decision.supplierSku,
        status: "pending",
      },
    }).catch(async () => {
      // If upsert fails (no ID match), try create
      await prisma.orderLineRouting.create({
        data: {
          orderRoutingId: orderRouting.id,
          shopifyLineItemId: lineItemId,
          supplier: decision.supplier,
          supplierSku: decision.supplierSku,
          qty: decision.qty,
          status: "pending",
        },
      }).catch(() => {}); // silently skip duplicates
    });
  }
}

// ─── Update cheapest supplier when prices change ───

export async function updateDefaultSupplier(
  shopId: string,
  upc: string
) {
  const match = await prisma.productMatch.findUnique({
    where: { shopId_upc: { shopId, upc } },
  });
  if (!match || match.lockedSupplier) return; // Locked = don't auto-update

  const candidates: { supplier: string; cost: number }[] = [];
  const skuPairs: [string, string | null][] = [
    ["eldorado", match.eldoradoSku],
    ["honeysplace", match.honeysplaceSku],
    ["nalpac", match.nalpacSku],
  ];

  for (const [supplier, sku] of skuPairs) {
    if (!sku) continue;
    const product = await prisma.supplierProduct.findFirst({
      where: { shopId, supplier, supplierSku: sku, isActive: true },
    });
    if (product?.cost && product.inventoryQty > 0) {
      candidates.push({ supplier, cost: product.cost });
    }
  }

  if (candidates.length === 0) return;
  candidates.sort((a, b) => a.cost - b.cost);
  const newDefault = candidates[0].supplier;

  if (newDefault !== match.defaultSupplier) {
    await prisma.productMatch.update({
      where: { shopId_upc: { shopId, upc } },
      data: {
        defaultSupplier: newDefault,
        lastPriceUpdateAt: new Date(),
      },
    });

    // If product is in Shopify, update its cost metafield
    if (match.shopifyProductId) {
      // This will be handled by the inventory sync job
    }
  }
}
