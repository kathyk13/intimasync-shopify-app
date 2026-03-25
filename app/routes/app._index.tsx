/**
 * IntimaSync - Dashboard
 * Landing page: stats, supplier status, quick actions, onboarding checklist
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Icon,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  let linkedCount = 0;
  let favoritesCount = 0;
  let supplierProductTotal = 0;
  let supplierCounts: Record<string, number> = {};
  let supplierCreds: Array<{ supplier: string; enabled: boolean }> = [];
  let recentSyncs: Array<{ supplier: string; syncType: string; status: string; startedAt: string; recordsProcessed: number; recordsUpdated: number }> = [];
  let dbError = false;

  try {
    const [matchCount, favCount, totalProducts, creds, syncs] = await Promise.all([
      prisma.productMatch.count({ where: { shopId: shop.id } }),
      prisma.productMatch.count({ where: { shopId: shop.id, isFavorite: true } }),
      prisma.supplierProduct.count({ where: { shopId: shop.id } }),
      prisma.supplierCredential.findMany({ where: { shopId: shop.id } }),
      prisma.syncLog.findMany({
        where: { shopId: shop.id },
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
    ]);
    linkedCount = matchCount;
    favoritesCount = favCount;
    supplierProductTotal = totalProducts;
    supplierCreds = creds;
    recentSyncs = syncs.map((s) => ({
      supplier: s.supplier,
      syncType: s.syncType,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
      recordsProcessed: s.recordsProcessed,
      recordsUpdated: s.recordsUpdated,
    }));

    // Get per-supplier product counts
    const supplierGroups = await prisma.supplierProduct.groupBy({
      by: ["supplier"],
      where: { shopId: shop.id },
      _count: true,
    });
    supplierGroups.forEach((g) => {
      supplierCounts[g.supplier] = g._count;
    });
  } catch (err) {
    console.error("Dashboard loader error:", err);
    dbError = true;
  }

  let shopifyProductCount = 0;
  let pendingOrders = 0;
  try {
    const r1 = await admin.graphql(`query { productsCount { count } }`);
    const d1 = await r1.json();
    shopifyProductCount = d1.data?.productsCount?.count ?? 0;
  } catch {}
  try {
    const r2 = await admin.graphql(`query { ordersCount(query: "fulfillment_status:unfulfilled financial_status:paid") { count } }`);
    const d2 = await r2.json();
    pendingOrders = d2.data?.ordersCount?.count ?? 0;
  } catch {}

  const suppliers: Record<string, boolean> = {};
  supplierCreds.forEach((c) => { suppliers[c.supplier] = c.enabled; });

  return json({
    shopifyProductCount,
    linkedCount,
    favoritesCount,
    supplierProductTotal,
    supplierCounts,
    pendingOrders,
    suppliers,
    recentSyncs,
    dbError,
  });
}

const SUPPLIER_NAMES: Record<string, string> = {
  honeysplace: "Honey's Place",
  eldorado: "Eldorado",
  nalpac: "Nalpac",
};
const ACTIVE_SUPPLIERS = ["honeysplace", "eldorado", "nalpac"];

export default function Dashboard() {
  const {
    shopifyProductCount, linkedCount, favoritesCount, supplierProductTotal,
    supplierCounts, pendingOrders, suppliers, recentSyncs, dbError,
  } = useLoaderData<typeof loader>();

  const [showOnboarding, setShowOnboarding] = useState(true);

  const connectedCount = ACTIVE_SUPPLIERS.filter((s) => suppliers[s] === true).length;
  const hasSyncedOnce = recentSyncs.length > 0;
  const hasProducts = supplierProductTotal > 0;
  const hasLinked = linkedCount > 0;

  // Onboarding progress
  const onboardingSteps = [
    { label: "Connect at least one supplier", done: connectedCount > 0, link: "/app/settings" },
    { label: "Run your first catalog sync", done: hasSyncedOnce, link: "/app/sync" },
    { label: "Products loaded from suppliers", done: hasProducts, link: "/app/products" },
    { label: "Link products to your Shopify store", done: hasLinked, link: "/app/products/linked" },
  ];
  const completedSteps = onboardingSteps.filter((s) => s.done).length;
  const allDone = completedSteps === onboardingSteps.length;

  return (
    <Page title="Dashboard" subtitle="IntimaSync supplier sync overview">
      <Layout>
        {dbError && (
          <Layout.Section>
            <Banner tone="warning" title="Dashboard data unavailable">
              <p>Could not load stats from the database. Please reload the page.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Onboarding Checklist */}
        {showOnboarding && !allDone && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Getting Started</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {completedSteps} of {onboardingSteps.length} steps complete
                    </Text>
                  </BlockStack>
                  <Button variant="plain" onClick={() => setShowOnboarding(false)}>Dismiss</Button>
                </InlineStack>
                <ProgressBar progress={(completedSteps / onboardingSteps.length) * 100} size="small" tone="primary" />
                <BlockStack gap="200">
                  {onboardingSteps.map((step) => (
                    <InlineStack key={step.label} gap="200" blockAlign="center">
                      <Icon
                        source={step.done ? CheckCircleIcon : AlertCircleIcon}
                        tone={step.done ? "success" : "subdued"}
                      />
                      <Text as="span" variant="bodySm" tone={step.done ? "success" : undefined}>
                        {step.done ? step.label : (
                          <Link to={step.link}>{step.label}</Link>
                        )}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Stats Row */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "16px" }}>
            {[
              { label: "Shopify Products", value: shopifyProductCount.toLocaleString() },
              { label: "Supplier Catalog", value: supplierProductTotal.toLocaleString() },
              { label: "Linked Products", value: linkedCount.toLocaleString() },
              { label: "Favorites", value: favoritesCount.toLocaleString() },
              { label: "Pending Orders", value: pendingOrders.toLocaleString(), badge: pendingOrders > 0 ? "Awaiting fulfillment" : undefined, tone: "attention" as const },
            ].map(({ label, value, badge, tone }) => (
              <Card key={label}>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                  <Text as="p" variant="heading2xl">{value}</Text>
                  {badge && <Badge tone={tone as any}>{badge}</Badge>}
                </BlockStack>
              </Card>
            ))}
          </div>
        </Layout.Section>

        {/* Supplier Connections + Quick Actions */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px" }}>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Supplier Connections</Text>
                  <Link to="/app/settings">
                    <Button size="slim" variant="plain">Manage</Button>
                  </Link>
                </InlineStack>
                <Divider />
                <BlockStack gap="300">
                  {ACTIVE_SUPPLIERS.map((sup) => {
                    const connected = suppliers[sup] === true;
                    const configured = sup in suppliers;
                    const count = supplierCounts[sup] || 0;
                    return (
                      <InlineStack key={sup} align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text as="span">{SUPPLIER_NAMES[sup]}</Text>
                          {count > 0 && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {count.toLocaleString()} products
                            </Text>
                          )}
                        </BlockStack>
                        <InlineStack gap="150" blockAlign="center">
                          <Icon
                            source={connected ? CheckCircleIcon : configured ? AlertCircleIcon : XCircleIcon}
                            tone={connected ? "success" : configured ? "caution" : "critical"}
                          />
                          <Badge tone={connected ? "success" : "attention"}>
                            {connected ? "Connected" : configured ? "Configured" : "Not set up"}
                          </Badge>
                        </InlineStack>
                      </InlineStack>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Quick Actions</Text>
                <Divider />
                <BlockStack gap="200">
                  <Link to="/app/sync"><Button fullWidth>Sync Now</Button></Link>
                  <Link to="/app/products"><Button fullWidth>Browse Catalog</Button></Link>
                  <Link to="/app/products/linked"><Button fullWidth>Linked Products</Button></Link>
                  <Link to="/app/products/favorites"><Button fullWidth>Favorites</Button></Link>
                  <Link to="/app/settings"><Button fullWidth>Settings</Button></Link>
                </BlockStack>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Recent Syncs */}
        {recentSyncs.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Recent Sync Activity</Text>
                  <Link to="/app/sync">
                    <Button size="slim" variant="plain">View All</Button>
                  </Link>
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  {recentSyncs.map((s, i) => (
                    <InlineStack key={i} align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={
                          s.status === "success" ? "success" :
                          s.status === "failed" ? "critical" :
                          s.status === "partial" ? "attention" : "info"
                        }>
                          {s.status}
                        </Badge>
                        <Text as="span" variant="bodySm">
                          {SUPPLIER_NAMES[s.supplier] || s.supplier} - {s.syncType}
                        </Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {new Date(s.startedAt).toLocaleString()}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
