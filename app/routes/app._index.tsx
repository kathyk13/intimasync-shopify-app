/**
 * IntimaSync - Dashboard
 * Landing page: stats, supplier status, quick actions
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
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  let linkedCount = 0;
  let supplierProducts = 0;
  let supplierCreds: Array<{ supplier: string; enabled: boolean }> = [];
  let dbError = false;
  try {
    const dbResult = await Promise.all([
      prisma.productMatch.count({ where: { shopId: shop.id } }),
      prisma.supplierProduct.count({ where: { shopId: shop.id } }),
      prisma.supplierCredential.findMany({ where: { shopId: shop.id } }),
    ]);
    linkedCount = dbResult[0];
    supplierProducts = dbResult[1];
    supplierCreds = dbResult[2];
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

  return json({ shopifyProductCount, linkedCount, supplierProducts, pendingOrders, suppliers, dbError });
}

const SUPPLIER_NAMES: Record<string, string> = {
  honeysplace: "Honey's Place",
  eldorado: "Eldorado",
  nalpac: "Nalpac",
  ecn: "East Coast News",
  sextoydistributing: "SexToyDistributing",
};
const ALL_SUPPLIERS = ["honeysplace", "eldorado", "nalpac", "ecn", "sextoydistributing"];

export default function Dashboard() {
  const { shopifyProductCount, linkedCount, supplierProducts, pendingOrders, suppliers, dbError } =
    useLoaderData<typeof loader>();

  const unmatchedCount = Math.max(0, shopifyProductCount - linkedCount);
  const matchPct = shopifyProductCount > 0 ? Math.round((linkedCount / shopifyProductCount) * 100) : 0;

  return (
    <Page title="Dashboard" subtitle="IntimaSync supplier sync overview">
      {dbError && (
        <Banner tone="warning" title="Dashboard data unavailable">
          <p>Could not load stats from the database. This usually means the app database tables haven’t been initialized yet. Please run <code>prisma db push</code> and reload.</p>
        </Banner>
      )}
            <Layout>
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "16px" }}>
            {[
              { label: "Shopify Products", value: shopifyProductCount },
              { label: "Supplier Catalog Items", value: supplierProducts.toLocaleString() },
              { label: "Linked Products", value: linkedCount, badge: `${matchPct}% matched`, tone: linkedCount > 0 ? "success" : "attention" },
              { label: "Unmatched Products", value: unmatchedCount, badge: unmatchedCount > 0 ? "Needs attention" : undefined, tone: "critical" },
              { label: "Pending Orders", value: pendingOrders, badge: pendingOrders > 0 ? "Awaiting fulfillment" : undefined, tone: "warning" },
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
                  {ALL_SUPPLIERS.map((sup) => {
                    const connected = suppliers[sup] === true;
                    const configured = sup in suppliers;
                    return (
                      <InlineStack key={sup} align="space-between" blockAlign="center">
                        <Text as="span">{SUPPLIER_NAMES[sup]}</Text>
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
                  <Link to="/app/products"><Button fullWidth>Browse Supplier Products</Button></Link>
                  <Link to="/app/products/linked"><Button fullWidth>View Linked Products</Button></Link>
                  <Link to="/app/products/favorites"><Button fullWidth>View Favorites</Button></Link>
                  <Link to="/app/settings"><Button fullWidth>Supplier Settings</Button></Link>
                  <Link to="/app/billing"><Button fullWidth>Billing &amp; Plans</Button></Link>
                </BlockStack>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
