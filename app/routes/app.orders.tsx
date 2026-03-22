/**
 * IntimaSync - Orders Page
 * Shows all supplier-routed orders and their statuses
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  EmptyState,
  Button,
  Pagination,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
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

  const [orders, total] = await Promise.all([
    prisma.orderRouting.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        lines: true,
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
      updatedAt: o.updatedAt.toISOString(),
      lines: o.lines.map((l) => ({
        supplier: l.supplier,
        supplierOrderId: l.supplierOrderId,
        status: l.status,
        trackingNumber: l.trackingNumber,
        trackingUrl: l.trackingUrl,
      })),
    })),
    total,
    page,
    perPage,
  });
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
  const { orders, total, page, perPage } = useLoaderData<typeof loader>();

  if (orders.length === 0) {
    return (
      <Page title="Orders">
        <EmptyState
          heading="No orders routed yet"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>
            When customers place orders in your Shopify store, IntimaSync will
            automatically route them to the correct supplier. Routed orders will
            appear here.
          </p>
        </EmptyState>
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
      order.lines.map((l) => l.supplierOrderId).filter(Boolean).join(", ") || "â",
      tracking.length > 0 ? tracking : "â",
      new Date(order.createdAt).toLocaleDateString(),
    ];
  });

  return (
    <Page
      title="Orders"
      subtitle={`${total.toLocaleString()} orders routed to suppliers`}
    >
      <Layout>
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
              onPrevious={() => {
                window.location.href = `/app/orders?page=${page - 1}`;
              }}
              hasNext={page * perPage < total}
              onNext={() => {
                window.location.href = `/app/orders?page=${page + 1}`;
              }}
            />
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
