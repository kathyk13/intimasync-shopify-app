/**
 * IntimaSync - Linked Products
 * Shows Shopify store products, their supplier match status, cost, and qty sold
 */

import { useState } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  Thumbnail,
  InlineStack,
  BlockStack,
  Tooltip,
  Icon,
  Banner,
  Pagination,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// âââ Loader âââ
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Error("Shop not found");

  try {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = 50;

  // Fetch products from Shopify
  const response = await admin.graphql(
    `
    query GetProducts($first: Int!) {
      products(first: $first, query: "status:active OR status:draft") {
        nodes {
          id
          title
          status
          images(first: 1) { nodes { url } }
          variants(first: 1) {
            nodes {
              id
              sku
              barcode
              price
            }
          }
          totalInventory
        }
      }
    }
  `,
    { variables: { first: 250 } }
  );

  const data = await response.json();
  const shopifyProducts = data.data?.products?.nodes || [];

  // Fetch order line items to get qty sold per product
  // We query top-level order data for the last 90 days
  const ordersResponse = await admin.graphql(`
    query {
      orders(first: 250, query: "created_at:>=${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}") {
        nodes {
          lineItems(first: 50) {
            nodes {
              product { id }
              quantity
            }
          }
        }
      }
    }
  `);
  const ordersData = await ordersResponse.json();
  const qtySoldMap: Record<string, number> = {};
  for (const order of ordersData.data?.orders?.nodes || []) {
    for (const line of order.lineItems?.nodes || []) {
      if (line.product?.id) {
        qtySoldMap[line.product.id] =
          (qtySoldMap[line.product.id] || 0) + line.quantity;
      }
    }
  }

  const products = [];
  for (const product of shopifyProducts) {
    const variant = product.variants?.nodes?.[0];
    const upc = variant?.barcode || "";
    const shopifySku = variant?.sku || "";

    const match = await prisma.productMatch.findFirst({
      where: { shopId: shop.id, shopifyProductId: product.id },
    });

    let matchStatus: "linked" | "potential" | "unmatched" = "unmatched";
    let potentialUpc: string | null = null;
    let lowestCost: number | null = null;
    let defaultSupplier: string | null = null;

    if (match) {
      matchStatus = "linked";
      // Get lowest cost supplier
      const supplierProducts = await prisma.supplierProduct.findMany({
        where: { shopId: shop.id, upc: match.upc },
      });
      for (const sp of supplierProducts) {
        if (sp.inventoryQty > 0 && sp.cost != null) {
          if (lowestCost === null || (sp.cost && sp.cost < lowestCost)) {
            lowestCost = sp.cost;
            defaultSupplier = match.lockedSupplier || sp.supplier;
          }
        }
      }
    } else if (upc) {
      const potentialMatch = await prisma.productMatch.findFirst({
        where: { shopId: shop.id, upc },
      });
      if (potentialMatch) {
        matchStatus = "potential";
        potentialUpc = upc;
      }
    }

    products.push({
      shopifyProductId: product.id,
      title: product.title,
      status: product.status,
      imageUrl: product.images?.nodes?.[0]?.url || null,
      shopifySku,
      upc: match?.upc || upc,
      matchStatus,
      potentialUpc,
      eldoradoSku: match?.eldoradoSku || null,
      honeysplaceSku: match?.honeysplaceSku || null,
      nalpacSku: match?.nalpacSku || null,
      lowestCost,
      defaultSupplier,
      qtySold: qtySoldMap[product.id] || 0,
    });
  }

  const paginated = products.slice((page - 1) * perPage, page * perPage);

    return json({
      products: paginated,
      total: products.length,
      page,
      perPage,
      linkedCount: products.filter((p) => p.matchStatus === "linked").length,
      potentialCount: products.filter((p) => p.matchStatus === "potential").length,
      unmatchedCount: products.filter((p) => p.matchStatus === "unmatched").length,
      dbError: false,
    });
  } catch (err) {
    console.error("Linked loader error:", err);
    return json({ products: [], total: 0, page: 1, perPage: 50, linkedCount: 0, potentialCount: 0, unmatchedCount: 0, dbError: true });
  }
}

// âââ Action âââ
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) return json({ error: "Shop not found" });

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "confirm_link") {
    const shopifyProductId = String(formData.get("shopifyProductId"));
    const upc = String(formData.get("upc"));
    const match = await prisma.productMatch.findFirst({
      where: { shopId: shop.id, upc },
    });
    if (match) {
      await prisma.productMatch.update({
        where: { id: match.id },
        data: { shopifyProductId, importedAt: new Date() },
      });
    }
    return json({ success: true });
  }

  return json({ error: "Unknown intent" });
}

const supplierLabel: Record<string, string> = {
  eldorado: "Eldorado",
  honeysplace: "Honey's Place",
  nalpac: "Nalpac",
};

// âââ Component âââ
export default function LinkedProductsPage() {
  const { products, total, page, perPage, linkedCount, potentialCount, unmatchedCount, dbError } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const statusIcon = (status: string) => {
    if (status === "linked")
      return <Icon source={CheckCircleIcon} tone="success" />;
    if (status === "potential")
      return <Icon source={AlertCircleIcon} tone="caution" />;
    return <Icon source={XCircleIcon} tone="critical" />;
  };

  const shopifyAdminBase = `https://${typeof window !== "undefined" ? window.location.hostname.replace("admin.", "") : ""}/admin`;

  const rowMarkup = products.map((p, index) => (
    <IndexTable.Row id={p.shopifyProductId} key={p.shopifyProductId} position={index}>
      <IndexTable.Cell>
        <Thumbnail source={p.imageUrl || ""} alt={p.title} size="small" />
      </IndexTable.Cell>

      {/* Title - linked to product detail page if matched, Shopify admin otherwise */}
      <IndexTable.Cell>
        <BlockStack gap="050">
          {p.matchStatus === "linked" && p.upc ? (
            <Link to={`/app/products/${p.upc}`}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {p.title}
              </Text>
            </Link>
          ) : (
            <a
              href={`${shopifyAdminBase}/products/${p.shopifyProductId.split("/").pop()}`}
              target="_blank"
              rel="noreferrer"
            >
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {p.title}
              </Text>
            </a>
          )}
          <Text as="span" variant="bodySm" tone="subdued">
            {p.shopifySku ? `SKU: ${p.shopifySku}` : "No SKU"}
            {p.upc ? ` | UPC: ${p.upc}` : ""}
          </Text>
        </BlockStack>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <Badge tone={p.status === "ACTIVE" ? "success" : "attention"}>
          {p.status}
        </Badge>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          {statusIcon(p.matchStatus)}
          {p.matchStatus === "linked" && <Badge tone="success">Linked</Badge>}
          {p.matchStatus === "potential" && <Badge tone="attention">Potential Match</Badge>}
          {p.matchStatus === "unmatched" && <Badge tone="critical">No Match</Badge>}
        </InlineStack>
      </IndexTable.Cell>

      <IndexTable.Cell>
        {p.lowestCost != null ? (
          <Text as="span">${Number(p.lowestCost).toFixed(2)}</Text>
        ) : (
          <Text as="span" tone="subdued">â</Text>
        )}
      </IndexTable.Cell>

      <IndexTable.Cell>
        {p.defaultSupplier ? (
          <Badge>{supplierLabel[p.defaultSupplier] || p.defaultSupplier}</Badge>
        ) : (
          <Text as="span" tone="subdued">â</Text>
        )}
      </IndexTable.Cell>

      <IndexTable.Cell>
        <Text as="span">{p.qtySold > 0 ? p.qtySold : "â"}</Text>
      </IndexTable.Cell>

      <IndexTable.Cell>
        {p.matchStatus === "potential" && (
          <Button
            size="slim"
            onClick={() => {
              const fd = new FormData();
              fd.append("intent", "confirm_link");
              fd.append("shopifyProductId", p.shopifyProductId);
              fd.append("upc", p.potentialUpc || "");
              fetcher.submit(fd, { method: "POST" });
            }}
          >
            Confirm Link
          </Button>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  if (dbError) {
    return (
      <Page title="Linked Products">
        <Banner tone="warning" title="Could not load linked products">
          <p>Product linking data could not be loaded. Please reload the page.</p>
        </Banner>
      </Page>
    );
  }

    return (
    <Page
      title="Linked Products"
      subtitle="Your Shopify products and their IntimaSync supplier connections"
    >
      <Layout>
        {potentialCount > 0 && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={`${potentialCount} product${potentialCount !== 1 ? "s" : ""} with potential supplier matches`}
            >
              Review and confirm the matches below to enable automatic order routing.
            </Banner>
          </Layout.Section>
        )}
        {unmatchedCount > 0 && (
          <Layout.Section>
            <Banner
              tone="critical"
              title={`${unmatchedCount} product${unmatchedCount !== 1 ? "s" : ""} not found at any supplier`}
            >
              These products may have been discontinued or have missing UPCs.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={total}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Shopify Status" },
                { title: "Link Status" },
                { title: "Cost" },
                { title: "Default Supplier" },
                { title: "Qty Sold (90d)" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
          <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => {
                window.location.href = `/app/products/linked?page=${page - 1}`;
              }}
              hasNext={page * perPage < total}
              onNext={() => {
                window.location.href = `/app/products/linked?page=${page + 1}`;
              }}
            />
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
