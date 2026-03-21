/**
 * IntimaSync - Dashboard
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Badge,
  Button,
  DataTable,
  Banner,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  const shopId = shop.id;

  // Stats
  const [
    totalMatches,
    totalImported,
    favoriteCount,
    outOfStockCount,
    eldoradoEnabled,
    honeysplaceEnabled,
    nalpacEnabled,
    recentSyncs,
    recentOrders,
  ] = await Promise.all([
    prisma.productMatch.count({ where: { shopId } }),
    prisma.productMatch.count({ where: { shopId, shopifyProductId: { not: null } } }),
    prisma.productMatch.count({ where: { shopId, isFavorite: true } }),
    // Products with 0 stock at all suppliers
    prisma.productMatch.count({
      where: {
        shopId,
        shopifyProductId: { not: null },
      },
    }),
    prisma.supplierCredential.findFirst({ where: { shopId, supplier: "eldorado", enabled: true } }),
    prisma.supplierCredential.findFirst({ where: { shopId, supplier: "honeysplace", enabled: true } }),
    prisma.supplierCredential.findFirst({ where: { shopId, supplier: "nalpac", enabled: true } }),
    prisma.syncLog.findMany({
      where: { shopId },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    prisma.orderRouting.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return json({
    stats: {
      totalMatches,
      totalImported,
      favoriteCount,
      outOfStockCount: 0, // TODO: calculate properly
    },
    suppliers: {
      eldorado: !!eldoradoEnabled,
      honeysplace: !!honeysplaceEnabled,
      nalpac: !!nalpacEnabled,
    },
    recentSyncs: recentSyncs.map((s) => ({
      supplier: s.supplier,
      syncType: s.syncType,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
      recordsUpdated: s.recordsUpdated,
    })),
    recentOrders: recentOrders.map((o) => ({
      orderNumber: o.shopifyOrderNumber || o.shopifyOrderId,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
    })),
  });
}

export default function Dashboard() {
  const { stats, suppliers, recentSyncs, recentOrders } = useLoaderData<typeof loader>();
  const supplierCount = Object.values(suppliers).filter(Boolean).length;

  return (
    <Page title="IntimaSync Dashboard">
      <Layout>
        {supplierCount === 0 && (
          <Layout.Section>
            <Banner
              title="Welcome to IntimaSync!"
              tone="info"
              action={{ content: "Configure Suppliers", url: "/app/settings" }}
            >
              Get started by adding your supplier credentials in Settings. Once connected,
              you can browse and import products from Eldorado, Honey's Place, and Nalpac.
            </Banner>
          </Layout.Section>
        )}

        {/* Stats Row */}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <StatCard title="Products Tracked" value={stats.totalMatches.toLocaleString()} />
            <StatCard title="Imported to Shopify" value={stats.totalImported.toLocaleString()} />
            <StatCard title="Favorites" value={stats.favoriteCount.toLocaleString()} />
            <StatCard title="Suppliers Connected" value={`${supplierCount}/3`} />
          </InlineStack>
        </Layout.Section>

        {/* Supplier Status */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Supplier Status</Text>
              <Divider />
              <BlockStack gap="300">
                <SupplierStatusRow
                  name="Eldorado"
                  connected={suppliers.eldorado}
                  configUrl="/app/settings#eldorado"
                />
                <SupplierStatusRow
                  name="Honey's Place"
                  connected={suppliers.honeysplace}
                  configUrl="/app/settings#honeysplace"
                />
                <SupplierStatusRow
                  name="Nalpac"
                  connected={suppliers.nalpac}
                  configUrl="/app/settings#nalpac"
                />
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Syncs */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Recent Syncs</Text>
                <Button variant="plain" url="/app/sync">View All</Button>
              </InlineStack>
              {recentSyncs.length === 0 ? (
                <Text as="p" tone="subdued">No syncs yet. Configure suppliers to get started.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "numeric"]}
                  headings={["Supplier", "Type", "Status", "Updated"]}
                  rows={recentSyncs.map((s) => [
                    s.supplier,
                    s.syncType,
                    <Badge tone={s.status === "success" ? "success" : s.status === "failed" ? "critical" : "attention"}>
                      {s.status}
                    </Badge>,
                    s.recordsUpdated,
                  ])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Orders */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Recent Orders Routed</Text>
                <Button variant="plain" url="/app/orders">View All</Button>
              </InlineStack>
              {recentOrders.length === 0 ? (
                <Text as="p" tone="subdued">No orders routed yet.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Order #", "Status", "Date"]}
                  rows={recentOrders.map((o) => [
                    o.orderNumber,
                    <Badge tone={o.status === "fulfilled" ? "success" : "attention"}>{o.status}</Badge>,
                    new Date(o.createdAt).toLocaleDateString(),
                  ])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Quick Actions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Quick Actions</Text>
              <Divider />
              <InlineStack gap="300" wrap>
                <Button url="/app/products">Browse Products</Button>
                <Button url="/app/products/favorites">View Favorites</Button>
                <Button url="/app/products/linked">Linked Products</Button>
                <Button url="/app/settings">Settings</Button>
                <Button variant="primary" url="/app/sync" tone="success">Sync Now</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
        <Text as="p" variant="headingXl">{value}</Text>
      </BlockStack>
    </Card>
  );
}

function SupplierStatusRow({
  name,
  connected,
  configUrl,
}: {
  name: string;
  connected: boolean;
  configUrl: string;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span">{name}</Text>
        <Badge tone={connected ? "success" : "attention"}>
          {connected ? "Connected" : "Not configured"}
        </Badge>
      </InlineStack>
      {!connected && (
        <Button variant="plain" url={configUrl} size="slim">Configure</Button>
      )}
    </InlineStack>
  );
}
