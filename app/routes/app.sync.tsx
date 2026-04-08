/**
 * IntimaSync - Manual Sync Trigger
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  DataTable,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { runInventorySync, syncProductCatalog } from "../lib/inventory-sync.server";
import { CATALOG_SYNC_IDS, type CatalogSyncSupplierId } from "../lib/suppliers.config";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Error("Shop not found");

  try {
    // Auto-clean stuck "running" sync logs older than 15 minutes
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    await prisma.syncLog.updateMany({
      where: {
        shopId: shop.id,
        status: "running",
        startedAt: { lt: fifteenMinAgo },
      },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorsJson: JSON.stringify([{ message: "Sync timed out (auto-cleaned after 15 minutes)" }]),
      },
    });

    const logs = await prisma.syncLog.findMany({
      where: { shopId: shop.id },
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    return json({
      logs: logs.map((l) => ({
        supplier: l.supplier,
        syncType: l.syncType,
        status: l.status,
        startedAt: l.startedAt.toISOString(),
        completedAt: l.completedAt?.toISOString() || null,
        recordsProcessed: l.recordsProcessed,
        recordsUpdated: l.recordsUpdated,
        errorsJson: l.errorsJson || null,
      })),
      dbError: false,
    });
  } catch (err) {
    console.error("Sync loader error:", err);
    return json({ logs: [], dbError: true });
  }
}

// FIX: Added action export so POST requests from the Products page "Sync Now"
// button (and the sync page itself) are handled correctly instead of 405.
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Error("Shop not found");

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const supplier = formData.get("supplier") as string | null;

  try {
    // "sync" is sent by the Products page "Sync Now" button
    if (intent === "sync_inventory" || intent === "sync") {
      // Fire-and-forget: start in background, return immediately
      runInventorySync(shop.id).catch((err) =>
        console.error("[sync] inventory sync crashed:", err)
      );
      return json({
        success: true,
        message: "Inventory sync started. Refresh this page in a few minutes to see results.",
      });
    }

    if (intent === "sync_catalog" && supplier) {
      if (!CATALOG_SYNC_IDS.includes(supplier as CatalogSyncSupplierId)) {
        return json({ success: false, error: "Unknown supplier" });
      }
      // Fire-and-forget: start in background, return immediately
      // This prevents Render/browser timeouts for large catalogs (Nalpac ~19K products)
      syncProductCatalog(shop.id, supplier as CatalogSyncSupplierId).catch(
        (err) => console.error(`[sync] ${supplier} catalog sync crashed:`, err)
      );
      return json({
        success: true,
        message: `${supplier} catalog sync started. Refresh this page in a few minutes to see results.`,
      });
    }

    return json({ success: false, error: "Unknown intent" });
  } catch (err) {
    return json({ success: false, error: String(err) });
  }
}

export default function SyncPage() {
  const { logs, dbError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [activeIntent, setActiveIntent] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle") setActiveIntent(null);
  }, [fetcher.state]);

  const triggerSync = (intent: string, supplier?: string) => {
    const key = intent + (supplier || "");
    setActiveIntent(key);
    const fd = new FormData();
    fd.append("intent", intent);
    if (supplier) fd.append("supplier", supplier);
    fetcher.submit(fd, { method: "POST" });
  };

  const isBtn = (intent: string, supplier?: string) =>
    fetcher.state === "submitting" && activeIntent === intent + (supplier || "");

  if (dbError) {
    return (
      <Page title="Sync History">
        <Banner tone="warning" title="Sync data unavailable">
          <p>Sync history could not be loaded. This may be a temporary issue - please reload the page.</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Sync"
      subtitle="Manage product catalog and inventory synchronization"
    >
      <Layout>
        {fetcher.data && (
          <Layout.Section>
            <Banner
              tone={(fetcher.data as any).success ? "info" : "critical"}
            >
              {(fetcher.data as any).success
                ? (fetcher.data as any).message || "Sync started."
                : `Sync error: ${(fetcher.data as any).error}`}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Sync Actions
              </Text>
              <Text as="p" tone="subdued">
                Sync inventory updates quantities and prices for products already
                in your Shopify store. Sync catalog fetches new product listings
                from suppliers (takes longer).
              </Text>
              <InlineStack gap="300" wrap>
                <Button
                  variant="primary"
                  loading={isBtn("sync_inventory")}
                  onClick={() => triggerSync("sync_inventory")}
                >
                  Sync Inventory Now
                </Button>
                <Button
                  loading={isBtn("sync_catalog", "honeysplace")}
                  onClick={() => triggerSync("sync_catalog", "honeysplace")}
                >
                  Sync Honey&apos;s Place Catalog
                </Button>
                <Button
                  loading={isBtn("sync_catalog", "nalpac")}
                  onClick={() => triggerSync("sync_catalog", "nalpac")}
                >
                  Sync Nalpac Catalog
                </Button>
                <Button
                  loading={isBtn("sync_catalog", "eldorado")}
                  onClick={() => triggerSync("sync_catalog", "eldorado")}
                >
                  Sync Eldorado Catalog
                </Button>
              </InlineStack>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  Estimated sync times: Inventory 1-3 min | Honey&apos;s Place catalog 5-10 min | Nalpac catalog 15-30 min (~19K products) | Eldorado catalog 5-15 min
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Tip: Honey&apos;s Place supports category/manufacturer filtering in their data feed portal, which can reduce feed size and sync time.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Automatic Sync
              </Text>
              <div style={{ opacity: 0.5, pointerEvents: "none" }}>
                <BlockStack gap="200">
                  <Text as="p" tone="subdued" variant="bodySm">
                    Daily inventory sync runs automatically at 3:00 AM EST to keep stock levels and pricing current.
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">Pro Feature</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Automatic daily sync is available on the Pro plan.
                    </Text>
                  </InlineStack>
                </BlockStack>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Sync History
              </Text>
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                ]}
                headings={[
                  "Supplier",
                  "Type",
                  "Status",
                  "Started",
                  "Processed",
                  "Updated",
                  "Errors",
                ]}
                rows={logs.map((l) => {
                  let errorDisplay = "";
                  if (l.errorsJson) {
                    try {
                      const errs = JSON.parse(l.errorsJson);
                      errorDisplay = Array.isArray(errs)
                        ? errs.slice(0, 3).join("; ") + (errs.length > 3 ? ` (+${errs.length - 3} more)` : "")
                        : String(errs);
                    } catch {
                      errorDisplay = l.errorsJson;
                    }
                  }
                  return [
                    l.supplier,
                    l.syncType,
                    <Badge
                      tone={
                        l.status === "success"
                          ? "success"
                          : l.status === "failed"
                          ? "critical"
                          : "attention"
                      }
                    >
                      {l.status}
                    </Badge>,
                    new Date(l.startedAt).toLocaleString(),
                    l.recordsProcessed,
                    l.recordsUpdated,
                    errorDisplay ? (
                      <Text as="span" tone="critical" variant="bodySm">
                        {errorDisplay.length > 120 ? errorDisplay.substring(0, 120) + "..." : errorDisplay}
                      </Text>
                    ) : "",
                  ];
                })}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
