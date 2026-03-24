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
      const result = await runInventorySync(shop.id);
      return json({
        success: result.success,
        updated: result.updated,
        error: result.errors[0] || null,
      });
    }

    if (intent === "sync_catalog" && supplier) {
      if (!CATALOG_SYNC_IDS.includes(supplier as CatalogSyncSupplierId)) {
        return json({ success: false, error: "Unknown supplier" });
      }
      const result = await syncProductCatalog(
        shop.id,
        supplier as CatalogSyncSupplierId
      );
      return json({
        success: result.errors.length === 0,
        updated: result.added + result.updated,
        added: result.added,
        error: result.errors[0] || null,
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
              tone={(fetcher.data as any).success ? "success" : "critical"}
            >
              {(fetcher.data as any).success
                ? `Sync complete. Updated ${(fetcher.data as any).updated || 0} records.${
                    (fetcher.data as any).added != null
                      ? ` (${(fetcher.data as any).added} new)`
                      : ""
                  }`
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
                ]}
                headings={[
                  "Supplier",
                  "Type",
                  "Status",
                  "Started",
                  "Processed",
                  "Updated",
                ]}
                rows={logs.map((l) => [
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
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
