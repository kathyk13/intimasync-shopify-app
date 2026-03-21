/**
 * IntimaSync - Linked Products
 * Shows Shopify store products and their supplier match status
 */

import { useState } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
  Modal,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ─── Loader ───

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  // Fetch products from Shopify
  const response = await admin.graphql(`
    query GetProducts($first: Int!) {
      products(first: $first, query: "status:active OR status:draft") {
        nodes {
          id
          title
          status
          images(first: 1) {
            nodes {
              url
            }
          }
          variants(first: 1) {
            nodes {
              id
              sku
              barcode
            }
          }
        }
      }
    }
  `, { variables: { first: 250 } });

  const data = await response.json();
  const shopifyProducts = data.data?.products?.nodes || [];

  // For each Shopify product, check its link status
  const linked = [];
  for (const product of shopifyProducts) {
    const variant = product.variants?.nodes?.[0];
    const upc = variant?.barcode || "";
    const shopifySku = variant?.sku || "";

    // Check if product is linked
    const match = await prisma.productMatch.findFirst({
      where: {
        shopId: shop.id,
        shopifyProductId: product.id,
      },
    });

    let status: "linked" | "potential" | "unmatched" = "unmatched";
    let potentialUpc: string | null = null;

    if (match) {
      status = "linked";
    } else if (upc) {
      // Check if UPC exists in our product catalog
      const potentialMatch = await prisma.productMatch.findFirst({
        where: { shopId: shop.id, upc },
      });
      if (potentialMatch) {
        status = "potential";
        potentialUpc = upc;
      }
    }

    linked.push({
      shopifyProductId: product.id,
      title: product.title,
      status: product.status,
      imageUrl: product.images?.nodes?.[0]?.url || null,
      shopifySku,
      upc,
      matchStatus: status,
      potentialUpc,
      eldoradoSku: match?.eldoradoSku || null,
      honeysplaceSku: match?.honeysplaceSku || null,
      nalpacSku: match?.nalpacSku || null,
    });
  }

  return json({ products: linked });
}

// ─── Action ───

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "confirm_link") {
    const shopifyProductId = String(formData.get("shopifyProductId"));
    const upc = String(formData.get("upc"));

    const match = await prisma.productMatch.findFirst({ where: { shopId: shop.id, upc } });
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

// ─── Component ───

export default function LinkedProductsPage() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const linked = products.filter((p) => p.matchStatus === "linked");
  const potential = products.filter((p) => p.matchStatus === "potential");
  const unmatched = products.filter((p) => p.matchStatus === "unmatched");

  const statusIcon = (status: string) => {
    if (status === "linked") return <Icon source={CheckCircleIcon} tone="success" />;
    if (status === "potential") return <Icon source={AlertCircleIcon} tone="caution" />;
    return <Icon source={XCircleIcon} tone="critical" />;
  };

  const statusLabel = (p: any) => {
    if (p.matchStatus === "linked") return <Badge tone="success">Linked</Badge>;
    if (p.matchStatus === "potential") return <Badge tone="attention">Potential Match</Badge>;
    return <Badge tone="critical">No Match Found</Badge>;
  };

  const rowMarkup = products.map((p, index) => (
    <IndexTable.Row id={p.shopifyProductId} key={p.shopifyProductId} position={index}>
      <IndexTable.Cell>
        <Thumbnail source={p.imageUrl || ""} alt={p.title} size="small" />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          {statusIcon(p.matchStatus)}
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">{p.title}</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {p.shopifySku ? `SKU: ${p.shopifySku}` : "No SKU"}{p.upc ? ` | UPC: ${p.upc}` : ""}
            </Text>
          </BlockStack>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={p.status === "ACTIVE" ? "success" : "attention"}>
          {p.status}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusLabel(p)}</IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100">
          {p.eldoradoSku && <Badge>ELD: {p.eldoradoSku}</Badge>}
          {p.honeysplaceSku && <Badge>HP: {p.honeysplaceSku}</Badge>}
          {p.nalpacSku && <Badge>NAL: {p.nalpacSku}</Badge>}
        </InlineStack>
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

  return (
    <Page
      title="Linked Products"
      subtitle="Manage your Shopify products' supplier connections"
    >
      <Layout>
        {potential.length > 0 && (
          <Layout.Section>
            <Banner tone="warning" title={`${potential.length} product${potential.length !== 1 ? "s" : ""} with potential supplier matches`}>
              Review and confirm the matches below to link them to IntimaSync.
            </Banner>
          </Layout.Section>
        )}
        {unmatched.length > 0 && (
          <Layout.Section>
            <Banner tone="critical" title={`${unmatched.length} product${unmatched.length !== 1 ? "s" : ""} not found at any supplier`}>
              These products may have been discontinued. Consider removing or replacing them.
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={products.length}
              onSelectionChange={() => {}}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Shopify Status" },
                { title: "Link Status" },
                { title: "Supplier SKUs" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
