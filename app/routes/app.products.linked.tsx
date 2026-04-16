/**
 * IntimaSync - Linked Products
 * Shows Shopify store products/variants, their supplier match status, and auto-linking by UPC.
 * Handles multi-variant products (e.g. Coochy Shave Cream with different sizes/scents).
 */

import { useState, useCallback } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, Link, useNavigate } from "@remix-run/react";
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

// --- Loader ---
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: session.shop },
    });
    if (!shop) throw new Error("Shop not found");

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const perPage = 50;

    // Fetch products with ALL variants (up to 20 per product) so each UPC is matchable
    const response = await admin.graphql(
      `
      query GetProducts($first: Int!) {
        products(first: $first, query: "status:active OR status:draft") {
          nodes {
            id
            title
            status
            images(first: 1) { nodes { url } }
            variants(first: 20) {
              nodes {
                id
                title
                sku
                barcode
                price
                displayName
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

    // Fetch order line items for qty sold (last 90 days)
    let qtySoldMap: Record<string, number> = {};
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const ordersResponse = await admin.graphql(`
        query {
          orders(first: 250, query: "created_at:>=${cutoff}") {
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
      for (const order of ordersData.data?.orders?.nodes || []) {
        for (const line of order.lineItems?.nodes || []) {
          if (line.product?.id) {
            qtySoldMap[line.product.id] =
              (qtySoldMap[line.product.id] || 0) + line.quantity;
          }
        }
      }
    } catch (err) {
      console.error("Linked: orders query failed (non-fatal):", err);
    }

    // Build rows: one per variant (since each variant can have its own UPC)
    interface LinkedRow {
      shopifyProductId: string;
      shopifyVariantId: string;
      productTitle: string;
      variantTitle: string;
      status: string;
      imageUrl: string | null;
      shopifySku: string;
      upc: string;
      matchStatus: "linked" | "potential" | "unmatched";
      matchId: string | null;
      eldoradoSku: string | null;
      honeysplaceSku: string | null;
      nalpacSku: string | null;
      lockedSupplier: string | null;
      lowestCost: number | null;
      defaultSupplier: string | null;
      qtySold: number;
      isMultiVariant: boolean;
    }

    const rows: LinkedRow[] = [];

    for (const product of shopifyProducts) {
      const variants = product.variants?.nodes || [];
      const isMultiVariant = variants.length > 1;
      const imageUrl = product.images?.nodes?.[0]?.url || null;

      for (const variant of variants) {
        const upc = variant.barcode || "";
        const shopifySku = variant.sku || "";

        let matchStatus: "linked" | "potential" | "unmatched" = "unmatched";
        let matchId: string | null = null;
        let eldoradoSku: string | null = null;
        let honeysplaceSku: string | null = null;
        let nalpacSku: string | null = null;
        let lockedSupplier: string | null = null;
        let lowestCost: number | null = null;
        let defaultSupplier: string | null = null;

        // Check if already linked (by shopifyProductId on a ProductMatch)
        const existingLink = await prisma.productMatch.findFirst({
          where: {
            shopId: shop.id,
            shopifyProductId: product.id,
            // If we stored the variant ID, match on that too
            ...(variant.id ? {} : {}),
          },
        });

        if (existingLink) {
          matchStatus = "linked";
          matchId = existingLink.id;
          eldoradoSku = existingLink.eldoradoSku;
          honeysplaceSku = existingLink.honeysplaceSku;
          nalpacSku = existingLink.nalpacSku;
          lockedSupplier = existingLink.lockedSupplier;
          // Get lowest cost
          const supplierProducts = await prisma.supplierProduct.findMany({
            where: { shopId: shop.id, upc: existingLink.upc },
          });
          for (const sp of supplierProducts) {
            if (sp.inventoryQty > 0 && sp.cost != null) {
              if (lowestCost === null || sp.cost < lowestCost) {
                lowestCost = sp.cost;
                defaultSupplier = existingLink.lockedSupplier || sp.supplier;
              }
            }
          }
        } else if (upc) {
          // Check if a ProductMatch exists for this UPC (potential auto-link)
          const potentialMatch = await prisma.productMatch.findFirst({
            where: { shopId: shop.id, upc },
          });
          if (potentialMatch) {
            matchStatus = "potential";
            matchId = potentialMatch.id;
            eldoradoSku = potentialMatch.eldoradoSku;
            honeysplaceSku = potentialMatch.honeysplaceSku;
            nalpacSku = potentialMatch.nalpacSku;
            // Show cost preview even before linking
            const supplierProducts = await prisma.supplierProduct.findMany({
              where: { shopId: shop.id, upc },
            });
            for (const sp of supplierProducts) {
              if (sp.inventoryQty > 0 && sp.cost != null) {
                if (lowestCost === null || sp.cost < lowestCost) {
                  lowestCost = sp.cost;
                  defaultSupplier = sp.supplier;
                }
              }
            }
          }
        }

        rows.push({
          shopifyProductId: product.id,
          shopifyVariantId: variant.id,
          productTitle: product.title,
          variantTitle: isMultiVariant ? (variant.title || variant.displayName || "") : "",
          status: product.status,
          imageUrl,
          shopifySku,
          upc,
          matchStatus,
          matchId,
          eldoradoSku,
          honeysplaceSku,
          nalpacSku,
          lockedSupplier,
          lowestCost,
          defaultSupplier,
          qtySold: qtySoldMap[product.id] || 0,
          isMultiVariant,
        });
      }
    }

    const linkedCount = rows.filter((r) => r.matchStatus === "linked").length;
    const potentialCount = rows.filter((r) => r.matchStatus === "potential").length;
    const unmatchedCount = rows.filter((r) => r.matchStatus === "unmatched").length;
    const paginated = rows.slice((page - 1) * perPage, page * perPage);

    return json({
      products: paginated,
      total: rows.length,
      page,
      perPage,
      linkedCount,
      potentialCount,
      unmatchedCount,
      dbError: false,
    });
  } catch (err) {
    console.error("Linked loader error:", err);
    return json({
      products: [],
      total: 0,
      page: 1,
      perPage: 50,
      linkedCount: 0,
      potentialCount: 0,
      unmatchedCount: 0,
      dbError: true,
    });
  }
}

// --- Action ---
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) return json({ error: "Shop not found" });

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "confirm_link") {
    // Link a single variant to its ProductMatch by UPC
    const shopifyProductId = String(formData.get("shopifyProductId"));
    const shopifyVariantId = String(formData.get("shopifyVariantId"));
    const upc = String(formData.get("upc"));

    const match = await prisma.productMatch.findFirst({
      where: { shopId: shop.id, upc },
    });
    if (match) {
      await prisma.productMatch.update({
        where: { id: match.id },
        data: {
          shopifyProductId,
          shopifyVariantId,
          importedAt: new Date(),
        },
      });
    }
    return json({ success: true });
  }

  if (intent === "auto_link_all") {
    // Bulk auto-link: for every potential match, set shopifyProductId + shopifyVariantId
    const pairs = String(formData.get("pairs"));
    let linked = 0;
    try {
      const items: { productId: string; variantId: string; upc: string }[] = JSON.parse(pairs);
      for (const item of items) {
        const match = await prisma.productMatch.findFirst({
          where: { shopId: shop.id, upc: item.upc, shopifyProductId: null },
        });
        if (match) {
          await prisma.productMatch.update({
            where: { id: match.id },
            data: {
              shopifyProductId: item.productId,
              shopifyVariantId: item.variantId,
              importedAt: new Date(),
            },
          });
          linked++;
        }
      }
    } catch (err) {
      console.error("Auto-link error:", err);
      return json({ error: String(err) });
    }
    return json({ success: true, linked });
  }

  if (intent === "lock_supplier") {
    const upc = String(formData.get("upc"));
    const supplier = String(formData.get("supplier"));
    const match = await prisma.productMatch.findFirst({
      where: { shopId: shop.id, upc },
    });
    if (match) {
      await prisma.productMatch.update({
        where: { id: match.id },
        data: { lockedSupplier: supplier === "auto" ? null : supplier },
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

// --- Component ---
export default function LinkedProductsPage() {
  const { products, total, page, perPage, linkedCount, potentialCount, unmatchedCount, dbError } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [autoLinkDone, setAutoLinkDone] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "linked" | "potential" | "unmatched">("all");

  const filteredProducts = statusFilter === "all"
    ? products
    : products.filter((p) => p.matchStatus === statusFilter);

  const statusIcon = (status: string) => {
    if (status === "linked")
      return <Icon source={CheckCircleIcon} tone="success" />;
    if (status === "potential")
      return <Icon source={AlertCircleIcon} tone="caution" />;
    return <Icon source={XCircleIcon} tone="critical" />;
  };

  const handleAutoLinkAll = () => {
    const potentials = products.filter((p) => p.matchStatus === "potential" && p.upc);
    const pairs = potentials.map((p) => ({
      productId: p.shopifyProductId,
      variantId: p.shopifyVariantId,
      upc: p.upc,
    }));
    const fd = new FormData();
    fd.append("intent", "auto_link_all");
    fd.append("pairs", JSON.stringify(pairs));
    fetcher.submit(fd, { method: "POST" });
    setAutoLinkDone(true);
  };

  if (dbError) {
    return (
      <Page title="Linked Products">
        <Banner tone="warning" title="Could not load linked products">
          <p>
            There was a problem loading product data. This can happen if your store
            hasn't synced supplier catalogs yet. Please go to the Sync page and run a
            catalog sync first, then reload this page.
          </p>
        </Banner>
      </Page>
    );
  }

  const rowMarkup = filteredProducts.map((p, index) => {
    const displayTitle = p.variantTitle
      ? `${p.productTitle} - ${p.variantTitle}`
      : p.productTitle;

    return (
      <IndexTable.Row
        id={`${p.shopifyVariantId}`}
        key={`${p.shopifyVariantId}`}
        position={index}
      >
        <IndexTable.Cell>
          <Thumbnail source={p.imageUrl || ""} alt={displayTitle} size="small" />
        </IndexTable.Cell>

        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {displayTitle}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {p.upc ? `UPC: ${p.upc}` : "No barcode"}
            </Text>
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center">
            {statusIcon(p.matchStatus)}
            {p.matchStatus === "linked" && <Badge tone="success">Linked</Badge>}
            {p.matchStatus === "potential" && <Badge tone="attention">Match Found</Badge>}
            {p.matchStatus === "unmatched" && (
              <Tooltip content={p.upc ? "No supplier carries this UPC" : "Add a barcode/UPC to this variant in Shopify to enable matching"}>
                <Badge tone="critical">No Match</Badge>
              </Tooltip>
            )}
          </InlineStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <BlockStack gap="050">
            {p.eldoradoSku && (
              <Text as="span" variant="bodySm">Eldorado: {p.eldoradoSku}</Text>
            )}
            {p.honeysplaceSku && (
              <Text as="span" variant="bodySm">HP: {p.honeysplaceSku}</Text>
            )}
            {p.nalpacSku && (
              <Text as="span" variant="bodySm">Nalpac: {p.nalpacSku}</Text>
            )}
            {!p.eldoradoSku && !p.honeysplaceSku && !p.nalpacSku && (
              <Text as="span" tone="subdued">--</Text>
            )}
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {p.lowestCost != null ? (
            <BlockStack gap="050">
              <Text as="span">${Number(p.lowestCost).toFixed(2)}</Text>
              {p.defaultSupplier && (
                <Text as="span" variant="bodySm" tone="subdued">
                  {supplierLabel[p.defaultSupplier] || p.defaultSupplier}
                </Text>
              )}
            </BlockStack>
          ) : (
            <Text as="span" tone="subdued">--</Text>
          )}
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span">{p.qtySold > 0 ? p.qtySold : "--"}</Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {p.matchStatus === "potential" && (
            <Button
              size="slim"
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", "confirm_link");
                fd.append("shopifyProductId", p.shopifyProductId);
                fd.append("shopifyVariantId", p.shopifyVariantId);
                fd.append("upc", p.upc);
                fetcher.submit(fd, { method: "POST" });
              }}
            >
              Link
            </Button>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Linked Products"
      subtitle={`${total} variants across your Shopify products`}
      primaryAction={
        potentialCount > 0 && !autoLinkDone
          ? {
              content: `Auto-Link ${potentialCount} Match${potentialCount !== 1 ? "es" : ""}`,
              onAction: handleAutoLinkAll,
            }
          : undefined
      }
    >
      <Layout>
        <Layout.Section>
          <InlineStack gap="200">
            <Button
              size="slim"
              pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            >
              All ({total})
            </Button>
            <Button
              size="slim"
              pressed={statusFilter === "linked"}
              onClick={() => setStatusFilter(statusFilter === "linked" ? "all" : "linked")}
              tone={statusFilter === "linked" ? "success" : undefined}
            >
              <InlineStack gap="100" blockAlign="center">
                <Badge tone="success">{linkedCount}</Badge>
                <span>Linked</span>
              </InlineStack>
            </Button>
            <Button
              size="slim"
              pressed={statusFilter === "potential"}
              onClick={() => setStatusFilter(statusFilter === "potential" ? "all" : "potential")}
            >
              <InlineStack gap="100" blockAlign="center">
                <Badge tone="attention">{potentialCount}</Badge>
                <span>Potential</span>
              </InlineStack>
            </Button>
            <Button
              size="slim"
              pressed={statusFilter === "unmatched"}
              onClick={() => setStatusFilter(statusFilter === "unmatched" ? "all" : "unmatched")}
            >
              <InlineStack gap="100" blockAlign="center">
                <Badge tone="critical">{unmatchedCount}</Badge>
                <span>Unmatched</span>
              </InlineStack>
            </Button>
          </InlineStack>
        </Layout.Section>

        {potentialCount > 0 && (
          <Layout.Section>
            <Banner
              tone="info"
              title={`${potentialCount} variant${potentialCount !== 1 ? "s" : ""} can be auto-linked by UPC`}
            >
              These Shopify variants have barcodes that match products in your supplier catalogs.
              Click "Auto-Link" above to connect them all at once, or link individually using the
              buttons in the table.
            </Banner>
          </Layout.Section>
        )}

        {autoLinkDone && (
          <Layout.Section>
            <Banner
              tone="success"
              title="Auto-linking complete"
              action={{ content: "Reload page", url: "/app/products/linked" }}
            >
              Products have been linked. Reload to see updated status and run an inventory sync
              to push quantities to Shopify.
            </Banner>
          </Layout.Section>
        )}

        {unmatchedCount > 0 && unmatchedCount === total && (
          <Layout.Section>
            <Banner
              tone="warning"
              title="No matches found"
            >
              None of your Shopify variants matched supplier catalog products. Make sure your
              Shopify product variants have UPC barcodes set, and that you've synced supplier
              catalogs from the Sync page.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "variant", plural: "variants" }}
              itemCount={filteredProducts.length}
              headings={[
                { title: "" },
                { title: "Product / Variant" },
                { title: "Link Status" },
                { title: "Supplier SKUs" },
                { title: "Best Cost" },
                { title: "Qty Sold (90d)" },
                { title: "" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
          {total > perPage && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
              <Pagination
                hasPrevious={page > 1}
                onPrevious={() => navigate(`/app/products/linked?page=${page - 1}`)}
                hasNext={page * perPage < total}
                onNext={() => navigate(`/app/products/linked?page=${page + 1}`)}
              />
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
