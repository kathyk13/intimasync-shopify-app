/**
 * IntimaSync - Favorites List
 * Shows favorited products with lowest price, default supplier, Shopify status
 */

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, Link } from "@remix-run/react";
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
  EmptyState,
  Tooltip,
  Pagination,
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
  const perPage = 50;

  const [matches, total] = await Promise.all([
    prisma.productMatch.findMany({
      where: { shopId: shop.id, isFavorite: true },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.productMatch.count({ where: { shopId: shop.id, isFavorite: true } }),
  ]);

  const rows = await Promise.all(
    matches.map(async (match) => {
      const supplierProducts = await prisma.supplierProduct.findMany({
        where: { shopId: shop.id, upc: match.upc },
      });

      const canonical = supplierProducts[0] || null;
      const images = canonical?.imagesJson ? JSON.parse(canonical.imagesJson) : [];

      // Find lowest cost with stock
      let lowestCost: number | null = null;
      let lowestSupplier: string | null = null;
      for (const sp of supplierProducts) {
        if (sp.inventoryQty > 0 && sp.cost != null) {
          if (lowestCost === null || (sp.cost && sp.cost < lowestCost)) {
            lowestCost = sp.cost;
            lowestSupplier = sp.supplier;
          }
        }
      }

      return {
        upc: match.upc,
        title: canonical?.title || "Unknown Product",
        imageUrl: images[0] || null,
        shopifyProductId: match.shopifyProductId,
        lockedSupplier: match.lockedSupplier,
        lowestCost,
        lowestSupplier: match.lockedSupplier || lowestSupplier,
      };
    })
  );

  return json({ rows, total, page, perPage });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) return json({ ok: false });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const upc = String(formData.get("upc"));

  if (intent === "remove_favorite") {
    const match = await prisma.productMatch.findFirst({
      where: { shopId: shop.id, upc },
    });
    if (match) {
      await prisma.productMatch.update({
        where: { id: match.id },
        data: { isFavorite: false },
      });
    }
  }

  return json({ ok: true });
}

const supplierLabel: Record<string, string> = {
  eldorado: "Eldorado",
  honeysplace: "Honey's Place",
  nalpac: "Nalpac",
};

export default function FavoritesPage() {
  const { rows, total, page, perPage } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  if (rows.length === 0) {
    return (
      <Page title="Favorites">
        <EmptyState
          heading="No favorites yet"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          action={{ content: "Browse Products", url: "/app/products" }}
        >
          <p>Star products in the Products view to add them to your favorites list.</p>
        </EmptyState>
      </Page>
    );
  }

  const rowMarkup = rows.map((row, index) => (
    <IndexTable.Row id={row.upc} key={row.upc} position={index}>
      <IndexTable.Cell>
        <Thumbnail
          source={
            row.imageUrl ||
            "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_small.png"
          }
          alt={row.title}
          size="small"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Link to={`/app/products/${row.upc}`}>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {row.title}
          </Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {row.upc}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">
          {row.lowestCost != null ? `$${Number(row.lowestCost).toFixed(2)}` : "â"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {row.lowestSupplier ? (
          <InlineStack gap="100" blockAlign="center">
            <Badge tone={row.lockedSupplier ? "attention" : "success"}>
              {supplierLabel[row.lowestSupplier] || row.lowestSupplier}
            </Badge>
            {row.lockedSupplier && (
              <Tooltip content="Manually locked to this supplier">
                <Text as="span" tone="subdued" variant="bodySm">Locked</Text>
              </Tooltip>
            )}
          </InlineStack>
        ) : (
          <Text as="span" tone="subdued">Out of stock</Text>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {row.shopifyProductId ? (
          <Badge tone="success">In Shopify</Badge>
        ) : (
          <Button
            size="slim"
            url={`/app/products/${row.upc}`}
          >
            Import
          </Button>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="slim"
          variant="plain"
          tone="critical"
          onClick={() => {
            const fd = new FormData();
            fd.append("intent", "remove_favorite");
            fd.append("upc", row.upc);
            submit(fd, { method: "POST" });
          }}
        >
          Remove
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Favorites"
      subtitle={`${total.toLocaleString()} favorited product${total !== 1 ? "s" : ""}`}
      primaryAction={{ content: "Browse All Products", url: "/app/products" }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={total}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "UPC" },
                { title: "Lowest Cost" },
                { title: "Default Supplier" },
                { title: "Shopify" },
                { title: "" },
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
                window.location.href = `/app/products/favorites?page=${page - 1}`;
              }}
              hasNext={page * perPage < total}
              onNext={() => {
                window.location.href = `/app/products/favorites?page=${page + 1}`;
              }}
            />
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
