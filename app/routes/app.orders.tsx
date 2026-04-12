/**
 * IntimaSync - Orders Page
 * Shows all supplier-routed orders and their statuses
 */

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  EmptyState,
  Pagination,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { routeOrder, type LineItemInput } from "../lib/order-routing.server";
import { useState } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Error("Shop not found");

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = 25;

  try {
    const [orders, total] = await Promise.all([
      prisma.orderRouting.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          lineRoutings: true,
        },
      }),
      prisma.orderRouting.count({ where: { shopId: shop.id } }),
    ]);

    return json({
      orders: orders.map((o) => ({
        id: o.id,
        shopifyOrderId: o.shopifyOrderId,
        shopifyOrderNumber: o.shopifyOrderNumber,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        lines: o.lineRoutings.map((l) => ({
          supplier: l.supplier,
          supplierOrderRef: l.supplierOrderRef || null,
          status: l.status,
          trackingNumber: l.trackingNumber,
          trackingUrl: l.trackingUrl || null,
        })),
      })),
      total,
      page,
      perPage,
      dbError: false,
    });
  } catch (err) {
    console.error("Orders loader error:", err);
    return json({ orders: [], total: 0, page, perPage, dbError: true });
  }
}

// --- Action: Backfill existing Shopify orders into IntimaSync ---
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) return json({ error: "Shop not found" });

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "backfill_orders") {
    try {
      // Fetch recent orders from Shopify that aren't already in IntimaSync
      const response = await admin.graphql(`
        query {
          orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              lineItems(first: 50) {
                nodes {
                  id
                  quantity
                  title
                  variant {
                    id
                  }
                  product {
                    id
                  }
                }
              }
            }
          }
        }
      `);
      const data = await response.json();
      const shopifyOrders = data.data?.orders?.nodes || [];

      let imported = 0;
      let skipped = 0;

      for (const order of shopifyOrders) {
        // Skip if already routed
        const existing = await prisma.orderRouting.findFirst({
          where: { shopId: shop.id, shopifyOrderId: order.id },
        });
        if (existing) {
          skipped++;
          continue;
        }

        const lineItems: LineItemInput[] = (order.lineItems?.nodes || [])
          .filter((li: any) => li.product?.id && li.variant?.id)
          .map((li: any) => ({
            shopifyLineItemId: li.id,
            shopifyVariantId: li.variant.id,
            shopifyProductId: li.product.id,
            quantity: li.quantity,
            title: li.title || "",
          }));

        if (lineItems.length === 0) continue;

        try {
          await routeOrder(shop.id, order.id, order.name || "", lineItems);
          imported++;
        } catch (err) {
          console.error(`Backfill error for order ${order.name}:`, err);
        }
      }

      return json({ success: true, imported, skipped });
    } catch (err) {
      console.error("Backfill action error:", err);
      return json({ error: String(err) });
    }
  }

  return json({ error: "Unknown intent" });
}

function statusTone(status: string): "success" | "attention" | "critical" | "info" | undefined {
  switch (status) {
    case "fulfilled": return "success";
    case "submitted": return "info";
    case "pending": return "attention";
    case "failed": return "critical";
    default: return undefined;
  }
}

export default function OrdersPage() {
  const { orders, total, page, perPage, dbError } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; imported?: number; skipped?: number; error?: string }>();
  const [backfillDone, setBackfillDone] = useState(false);

  const isBackfilling = fetcher.state !== "idle";
  const backfillResult = fetcher.data;

  // Show success banner after backfill completes
  if (backfillResult?.success && !backfillDone) {
    setBackfillDone(true);
  }

  function handleBackfill() {
    setBackfillDone(false);
    fetcher.submit({ intent: "backfill_orders" }, { method: "POST" });
  }

  if (dbError) {
    return (
      <Page title="Orders">
        <Banner tone="warning" title="Orders unavailable">
          <p>Order data could not be loaded. This usually means the database tables haven't been initialized yet. Run <code>prisma db push</code> to set up the schema, then reload.</p>
        </Banner>
      </Page>
    );
  }

  if (orders.length === 0) {
    return (
      <Page
        title="Orders"
        primaryAction={{
          content: isBackfilling ? "Importing..." : "Import Existing Orders",
          onAction: handleBackfill,
          loading: isBackfilling,
          disabled: isBackfilling,
        }}
      >
        <Layout>
          <Layout.Section>
            {backfillDone && backfillResult?.success && (
              <Banner
                tone="success"
                title="Order import complete"
                onDismiss={() => setBackfillDone(false)}
              >
                <p>
                  Imported {backfillResult.imported} order{backfillResult.imported !== 1 ? "s" : ""}.
                  {backfillResult.skipped ? ` ${backfillResult.skipped} already existed and were skipped.` : ""}
                  {backfillResult.imported && backfillResult.imported > 0 ? " Reload the page to see them." : ""}
                </p>
              </Banner>
            )}
            {backfillResult?.error && (
              <Banner tone="critical" title="Import failed">
                <p>{backfillResult.error}</p>
              </Banner>
            )}
            <EmptyState
              heading="No orders routed yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: isBackfilling ? "Importing..." : "Import Existing Orders",
                onAction: handleBackfill,
                loading: isBackfilling,
                disabled: isBackfilling,
              }}
            >
              <p>
                When customers place orders in your Shopify store, IntimaSync will
                automatically route them to the correct supplier. Routed orders will
                appear here.
              </p>
              <p>
                Already have orders? Click "Import Existing Orders" to pull in your
                recent Shopify orders and route them to suppliers.
              </p>
            </EmptyState>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = orders.map((order) => {
    const suppliers = [...new Set(order.lines.map((l) => l.supplier))];
    const tracking = order.lines
      .filter((l) => l.trackingNumber)
      .map((l) =>
        l.trackingUrl ? (
          <a href={l.trackingUrl} target="_blank" rel="noreferrer">
            {l.trackingNumber}
          </a>
        ) : (
          l.trackingNumber
        )
      );

    return [
      order.shopifyOrderNumber || order.shopifyOrderId,
      suppliers.join(", "),
      <Badge tone={statusTone(order.status)}>{order.status}</Badge>,
      order.lines.map((l) => l.supplierOrderRef).filter(Boolean).join(", ") || "—",
      tracking.length > 0 ? tracking : "—",
      new Date(order.createdAt).toLocaleDateString(),
    ];
  });

  return (
    <Page
      title="Orders"
      subtitle={`${total.toLocaleString()} orders routed to suppliers`}
      primaryAction={{
        content: isBackfilling ? "Importing..." : "Import Orders",
        onAction: handleBackfill,
        loading: isBackfilling,
        disabled: isBackfilling,
      }}
    >
      <Layout>
        <Layout.Section>
          {backfillDone && backfillResult?.success && (
            <Banner
              tone="success"
              title="Order import complete"
              onDismiss={() => setBackfillDone(false)}
            >
              <p>
                Imported {backfillResult.imported} order{backfillResult.imported !== 1 ? "s" : ""}.
                {backfillResult.skipped ? ` ${backfillResult.skipped} already existed and were skipped.` : ""}
                {backfillResult.imported && backfillResult.imported > 0 ? " Reload the page to see them." : ""}
              </p>
            </Banner>
          )}
          {backfillResult?.error && (
            <Banner tone="critical" title="Import failed">
              <p>{backfillResult.error}</p>
            </Banner>
          )}
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text"]}
              headings={[
                "Shopify Order",
                "Supplier(s)",
                "Status",
                "Supplier Order #",
                "Tracking",
                "Date",
              ]}
              rows={rows}
              footerContent={`${total} total orders`}
            />
          </Card>
          <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => navigate(`/app/orders?page=${page - 1}`)}
              hasNext={page * perPage < total}
              onNext={() => navigate(`/app/orders?page=${page + 1}`)}
            />
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
