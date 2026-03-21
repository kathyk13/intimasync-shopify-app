/**
 * IntimaSync - Daily Sync Script
 * Runs as a Render cron job at 6am UTC daily.
 * Syncs inventory and prices from all enabled suppliers.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log(`[${new Date().toISOString()}] Starting daily IntimaSync...`);

  // Get all active shops
  const shops = await prisma.shop.findMany({
    where: { billingActive: true },
  });

  console.log(`Found ${shops.length} active shop(s)`);

  for (const shop of shops) {
    try {
      console.log(`Syncing shop: ${shop.shopifyDomain}`);

      // Dynamically import to avoid loading issues in cron context
      const { runInventorySync } = await import("../app/lib/inventory-sync.server.js");
      const result = await runInventorySync(shop.id);

      console.log(`  Shop ${shop.shopifyDomain}: updated ${result.updated} products`);
      if (result.errors.length > 0) {
        console.error(`  Errors:`, result.errors);
      }
    } catch (err) {
      console.error(`Error syncing shop ${shop.shopifyDomain}:`, err);
    }
  }

  console.log(`[${new Date().toISOString()}] Daily sync complete.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal sync error:", err);
  process.exit(1);
});
