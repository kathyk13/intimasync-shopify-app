/**
 * IntimaSync - Manual Sync Trigger
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Button, Banner, DataTable, Badge, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { runInventorySync, syncProductCatalog } from "../lib/inventory-sync.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

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
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "sync_inventory");
  const supplier = formData.get("supplier") as "honeysplace" | "eldorado" | "nalpac" | null;

  if (intent === "sync_catalog" && supplier) {
    const result = await syncProductCatalog(shop.id, supplier);
    return json({ success: true, ...result });
  }

  if (intent === "sync_inventory") {
    const result = await runInventorySync(shop.id);
    return json({ success: true, ...result });
  }

  return json({ error: "Unknown intent" });
}

export default function SyncPage() {
  const { logs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isRunning = fetcher.state === "submitting";

  const triggerSync = (intent: string, supplier?: string) => {
    const fd = new FormData();
    fd.append("intent", intent);
    if (supplier) fd.append("supplier", supplier);
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <Page title="Sync" subtitle="Manage product catalog and inventory synchronization">
      <Layout>
        {fetcher.data && (
          <Layout.Section>
            <Banner tone={(fetcher.data as any).success ? "success" : "critical"}>
              {(fetcher.data as any).success
                ? `Sync complete. Updated ${(fetcher.data as any).updated || 0} records.`
                : `Sync error: ${(fetcher.data as any).error}`}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Sync Actions</Text>
              <Text as="p" tone="subdued">
                Sync inventory updates quantities and prices for products already in your Shopify store.
                Sync catalog fetches new product listings from suppliers (takes longer).
              </Text>
              <InlineStack gap="300" wrap>
                <Button
                  variant="primary"
                  loading={isRunning}
                  onClick={() => triggerSync("sync_inventory")}
                >
                  Sync Inventory Now
                </Button>
                <Button
                  loading={isRunning}
                  onClick={() => triggerSync("sync_catalog", "honeysplace")}
                >
                  Sync Honey's Place Catalog
                </Button>
                <Button
                  loading={isRunning}
                  onClick={() => triggerSync("sync_catalog", "nalpac")}
                >
                  Sync Nalpac Catalog
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Sync History</Text>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "numeric", "numeric"]}
                headings={["Supplier", "Type", "Status", "Started", "Processed", "Updated"]}
                rows={logs.map((l) => [
                  l.supplier,
                  l.syncType,
                  <Badge tone={l.status === "success" ? "success" : l.status === "failed" ? "critical" : "attention"}>
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
