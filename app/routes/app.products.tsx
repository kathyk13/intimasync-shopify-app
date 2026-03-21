/**
 * IntimaSync - Products List Page
 * Spreadsheet-style view comparing supplier pricing by UPC
 */

import { useState, useCallback } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Filters,
  ChoiceList,
  Pagination,
  Thumbnail,
  Icon,
  Tooltip,
  InlineStack,
  BlockStack,
  Select,
  Modal,
  TextField,
  Checkbox,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { LockIcon, StarIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ─── Types ───

interface ProductRow {
  upc: string;
  title: string;
  msrp: number | null;
  imageUrl: string | null;
  shopifyProductId: string | null;
  isFavorite: boolean;
  lockedSupplier: string | null;
  defaultSupplier: string | null;
  eldorado: { sku: string; cost: number; qty: number } | null;
  honeysplace: { sku: string; cost: number; qty: number } | null;
  nalpac: { sku: string; cost: number; qty: number } | null;
}

// ─── Loader ───

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = await getShopId(session.shop);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = parseInt(url.searchParams.get("perPage") || "50");
  const search = url.searchParams.get("search") || "";
  const category = url.searchParams.get("category") || "";
  const favoritesOnly = url.searchParams.get("favorites") === "true";
  const sortKey = url.searchParams.get("sort") || "title";
  const sortDir = (url.searchParams.get("dir") || "asc") as "asc" | "desc";

  // Get enabled suppliers
  const credentials = await prisma.supplierCredential.findMany({
    where: { shopId, enabled: true },
    select: { supplier: true },
  });
  const enabledSuppliers = credentials.map((c) => c.supplier);

  // Fetch product matches with their supplier product data
  const where: any = { shopId };
  if (favoritesOnly) where.isFavorite = true;

  // Build product rows from product matches
  const matches = await prisma.productMatch.findMany({
    where,
    skip: (page - 1) * perPage,
    take: perPage,
  });

  const total = await prisma.productMatch.count({ where });

  const rows: ProductRow[] = await Promise.all(
    matches.map(async (match) => {
      // Get supplier products for each enabled supplier
      const [eldoradoProduct, honeysplaceProduct, nalpacProduct] = await Promise.all([
        match.eldoradoSku && enabledSuppliers.includes("eldorado")
          ? prisma.supplierProduct.findFirst({
              where: { shopId, supplier: "eldorado", supplierSku: match.eldoradoSku },
            })
          : null,
        match.honeysplaceSku && enabledSuppliers.includes("honeysplace")
          ? prisma.supplierProduct.findFirst({
              where: { shopId, supplier: "honeysplace", supplierSku: match.honeysplaceSku },
            })
          : null,
        match.nalpacSku && enabledSuppliers.includes("nalpac")
          ? prisma.supplierProduct.findFirst({
              where: { shopId, supplier: "nalpac", supplierSku: match.nalpacSku },
            })
          : null,
      ]);

      // Get title and image from any supplier
      const anyProduct = eldoradoProduct || honeysplaceProduct || nalpacProduct;
      const images =
        anyProduct?.imagesJson ? JSON.parse(anyProduct.imagesJson) : [];

      return {
        upc: match.upc,
        title: anyProduct?.title || "Unknown Product",
        msrp: anyProduct?.msrp || null,
        imageUrl: images[0] || null,
        shopifyProductId: match.shopifyProductId,
        isFavorite: match.isFavorite,
        lockedSupplier: match.lockedSupplier,
        defaultSupplier: match.defaultSupplier,
        eldorado: eldoradoProduct
          ? {
              sku: eldoradoProduct.supplierSku,
              cost: eldoradoProduct.cost || 0,
              qty: eldoradoProduct.inventoryQty,
            }
          : null,
        honeysplace: honeysplaceProduct
          ? {
              sku: honeysplaceProduct.supplierSku,
              cost: honeysplaceProduct.cost || 0,
              qty: honeysplaceProduct.inventoryQty,
            }
          : null,
        nalpac: nalpacProduct
          ? {
              sku: nalpacProduct.supplierSku,
              cost: nalpacProduct.cost || 0,
              qty: nalpacProduct.inventoryQty,
            }
          : null,
      };
    })
  );

  // Get all categories
  const categoryResults = await prisma.supplierProduct.findMany({
    where: { shopId },
    select: { category: true },
    distinct: ["category"],
  });
  const categories = categoryResults
    .map((c) => c.category)
    .filter(Boolean)
    .sort() as string[];

  return json({
    rows,
    total,
    page,
    perPage,
    enabledSuppliers,
    categories,
    search,
    category,
    favoritesOnly,
    sortKey,
    sortDir,
  });
}

// ─── Action ───

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = await getShopId(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle_favorite") {
    const upc = String(formData.get("upc"));
    const match = await prisma.productMatch.findFirst({ where: { shopId, upc } });
    if (match) {
      await prisma.productMatch.update({
        where: { id: match.id },
        data: { isFavorite: !match.isFavorite },
      });
    }
    return json({ ok: true });
  }

  if (intent === "lock_supplier") {
    const upc = String(formData.get("upc"));
    const supplier = String(formData.get("supplier"));
    const match = await prisma.productMatch.findFirst({ where: { shopId, upc } });
    if (match) {
      await prisma.productMatch.update({
        where: { id: match.id },
        data: { lockedSupplier: supplier === "auto" ? null : supplier },
      });
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown intent" });
}

// ─── Component ───

export default function ProductsPage() {
  const { rows, total, page, perPage, enabledSuppliers, categories, favoritesOnly } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const fetcher = useFetcher();

  const [selectedUpcs, setSelectedUpcs] = useState<string[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [currentPerPage, setCurrentPerPage] = useState(String(perPage));

  const cheapestSupplier = (row: ProductRow): string | null => {
    if (row.lockedSupplier) return row.lockedSupplier;
    const options = [
      row.eldorado?.qty && row.eldorado.qty > 0 ? { s: "eldorado", c: row.eldorado.cost } : null,
      row.honeysplace?.qty && row.honeysplace.qty > 0 ? { s: "honeysplace", c: row.honeysplace.cost } : null,
      row.nalpac?.qty && row.nalpac.qty > 0 ? { s: "nalpac", c: row.nalpac.cost } : null,
    ].filter(Boolean) as { s: string; c: number }[];
    if (options.length === 0) return null;
    return options.sort((a, b) => a.c - b.c)[0].s;
  };

  const noStock = (row: ProductRow): boolean => {
    const totalQty =
      (row.eldorado?.qty || 0) + (row.honeysplace?.qty || 0) + (row.nalpac?.qty || 0);
    return totalQty === 0;
  };

  const formatCost = (
    cost: number | null | undefined,
    qty: number | null | undefined,
    isCheapest: boolean,
    isLocked: boolean
  ) => {
    if (cost == null || qty == null) return <Text as="span" tone="subdued">—</Text>;
    if (qty === 0) return <Text as="span" tone="subdued">$0.00 (OOS)</Text>;

    const text = `$${cost.toFixed(2)}`;
    return (
      <InlineStack gap="100" blockAlign="center">
        <Text as="span" tone={isCheapest ? "success" : undefined} fontWeight={isCheapest ? "bold" : undefined}>
          {text}
        </Text>
        {isLocked && (
          <Tooltip content="Supplier manually locked">
            <Icon source={LockIcon} tone="caution" />
          </Tooltip>
        )}
      </InlineStack>
    );
  };

  const rowMarkup = rows.map((row, index) => {
    const cheapest = cheapestSupplier(row);
    const outOfStock = noStock(row);
    const isSelected = selectedUpcs.includes(row.upc);

    return (
      <IndexTable.Row
        id={row.upc}
        key={row.upc}
        selected={isSelected}
        position={index}
        tone={outOfStock ? "critical" : undefined}
      >
        {/* Thumbnail */}
        <IndexTable.Cell>
          <Thumbnail
            source={row.imageUrl || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_small.png"}
            alt={row.title}
            size="small"
          />
        </IndexTable.Cell>

        {/* Product Name */}
        <IndexTable.Cell>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {row.title}
              </Text>
              {outOfStock && (
                <Badge tone="critical">Out of Stock</Badge>
              )}
              {row.shopifyProductId && (
                <Tooltip content="Imported to Shopify">
                  <Badge tone="success">In Shopify</Badge>
                </Tooltip>
              )}
              {row.isFavorite && (
                <Tooltip content="Favorited">
                  <Icon source={StarIcon} tone="warning" />
                </Tooltip>
              )}
            </InlineStack>
          </BlockStack>
        </IndexTable.Cell>

        {/* UPC */}
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">{row.upc}</Text>
        </IndexTable.Cell>

        {/* MSRP */}
        <IndexTable.Cell>
          <Text as="span">{row.msrp ? `$${row.msrp.toFixed(2)}` : "—"}</Text>
        </IndexTable.Cell>

        {/* Eldorado Cost */}
        {enabledSuppliers.includes("eldorado") && (
          <IndexTable.Cell>
            {formatCost(
              row.eldorado?.cost,
              row.eldorado?.qty,
              cheapest === "eldorado",
              row.lockedSupplier === "eldorado"
            )}
          </IndexTable.Cell>
        )}

        {/* Eldorado Qty */}
        {enabledSuppliers.includes("eldorado") && (
          <IndexTable.Cell>
            <Text as="span" tone={row.eldorado?.qty === 0 ? "critical" : undefined}>
              {row.eldorado?.qty ?? "—"}
            </Text>
          </IndexTable.Cell>
        )}

        {/* Honey's Place Cost */}
        {enabledSuppliers.includes("honeysplace") && (
          <IndexTable.Cell>
            {formatCost(
              row.honeysplace?.cost,
              row.honeysplace?.qty,
              cheapest === "honeysplace",
              row.lockedSupplier === "honeysplace"
            )}
          </IndexTable.Cell>
        )}

        {/* Honey's Place Qty */}
        {enabledSuppliers.includes("honeysplace") && (
          <IndexTable.Cell>
            <Text as="span" tone={row.honeysplace?.qty === 0 ? "critical" : undefined}>
              {row.honeysplace?.qty ?? "—"}
            </Text>
          </IndexTable.Cell>
        )}

        {/* Nalpac Cost */}
        {enabledSuppliers.includes("nalpac") && (
          <IndexTable.Cell>
            {formatCost(
              row.nalpac?.cost,
              row.nalpac?.qty,
              cheapest === "nalpac",
              row.lockedSupplier === "nalpac"
            )}
          </IndexTable.Cell>
        )}

        {/* Nalpac Qty */}
        {enabledSuppliers.includes("nalpac") && (
          <IndexTable.Cell>
            <Text as="span" tone={row.nalpac?.qty === 0 ? "critical" : undefined}>
              {row.nalpac?.qty ?? "—"}
            </Text>
          </IndexTable.Cell>
        )}

        {/* Fulfillment Source */}
        <IndexTable.Cell>
          <Select
            label=""
            labelHidden
            options={[
              { label: "Auto (Cheapest)", value: "auto" },
              ...(row.eldorado ? [{ label: "Eldorado", value: "eldorado" }] : []),
              ...(row.honeysplace ? [{ label: "Honey's Place", value: "honeysplace" }] : []),
              ...(row.nalpac ? [{ label: "Nalpac", value: "nalpac" }] : []),
            ]}
            value={row.lockedSupplier || "auto"}
            onChange={(value) => {
              const formData = new FormData();
              formData.append("intent", "lock_supplier");
              formData.append("upc", row.upc);
              formData.append("supplier", value);
              fetcher.submit(formData, { method: "POST" });
            }}
          />
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const headings = [
    { title: "" },
    { title: "Product" },
    { title: "UPC" },
    { title: "MSRP" },
    ...(enabledSuppliers.includes("eldorado")
      ? [{ title: "Eldorado Cost" }, { title: "Eld. Qty" }]
      : []),
    ...(enabledSuppliers.includes("honeysplace")
      ? [{ title: "HP Cost" }, { title: "HP Qty" }]
      : []),
    ...(enabledSuppliers.includes("nalpac")
      ? [{ title: "Nalpac Cost" }, { title: "Nalpac Qty" }]
      : []),
    { title: "Fulfillment Source" },
  ];

  return (
    <Page
      title="Products"
      subtitle={`${total.toLocaleString()} products across all suppliers`}
      primaryAction={{
        content: "Import Selected to Shopify",
        disabled: selectedUpcs.length === 0,
        onAction: () => setImportModalOpen(true),
      }}
      secondaryActions={[
        {
          content: "Export CSV",
          onAction: () => {
            window.location.href = "/app/products/export";
          },
        },
        {
          content: "Sync Now",
          onAction: () => {
            submit({ intent: "sync" }, { method: "POST", action: "/app/sync" });
          },
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          {enabledSuppliers.length === 0 && (
            <Banner
              title="No suppliers configured"
              tone="warning"
              action={{ content: "Go to Settings", url: "/app/settings" }}
            >
              Add your supplier credentials in Settings to see pricing and inventory.
            </Banner>
          )}
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={total}
              selectedItemsCount={selectedUpcs.length}
              onSelectionChange={(selectionType, isSelecting, selection) => {
                if (selectionType === "all") {
                  setSelectedUpcs(isSelecting ? rows.map((r) => r.upc) : []);
                } else if (selectionType === "single" && typeof selection === "string") {
                  setSelectedUpcs((prev) =>
                    isSelecting ? [...prev, selection] : prev.filter((id) => id !== selection)
                  );
                }
              }}
              headings={headings}
              loading={false}
              bulkActions={[
                {
                  content: "Add to Shopify as Draft",
                  onAction: () => setImportModalOpen(true),
                },
                {
                  content: "Add to Favorites",
                  onAction: () => {
                    selectedUpcs.forEach((upc) => {
                      const formData = new FormData();
                      formData.append("intent", "toggle_favorite");
                      formData.append("upc", upc);
                      fetcher.submit(formData, { method: "POST" });
                    });
                  },
                },
                {
                  content: "Download Images",
                  onAction: () => {
                    window.location.href = `/app/products/download-images?upcs=${selectedUpcs.join(",")}`;
                  },
                },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>

          <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => {
                submit({ page: String(page - 1), perPage: String(perPage) }, { method: "GET" });
              }}
              hasNext={page * perPage < total}
              onNext={() => {
                submit({ page: String(page + 1), perPage: String(perPage) }, { method: "GET" });
              }}
            />
          </div>
        </Layout.Section>
      </Layout>

      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        selectedUpcs={selectedUpcs}
        rows={rows.filter((r) => selectedUpcs.includes(r.upc))}
      />
    </Page>
  );
}

// ─── Import Modal ───

function ImportModal({
  open,
  onClose,
  selectedUpcs,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  selectedUpcs: string[];
  rows: ProductRow[];
}) {
  const submit = useSubmit();
  const [skuValues, setSkuValues] = useState<Record<string, string>>({});
  const [favoriteValues, setFavoriteValues] = useState<Record<string, boolean>>({});

  const handleImport = () => {
    const formData = new FormData();
    formData.append("intent", "import_products");
    formData.append("products", JSON.stringify(
      rows.map((row) => ({
        upc: row.upc,
        sku: skuValues[row.upc] || row.eldorado?.sku || row.honeysplace?.sku || row.nalpac?.sku || row.upc,
        addToFavorites: favoriteValues[row.upc] !== false, // default true
      }))
    ));
    submit(formData, { method: "POST", action: "/app/products/import" });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import ${rows.length} product${rows.length !== 1 ? "s" : ""} to Shopify`}
      primaryAction={{ content: "Import as Drafts", onAction: handleImport }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Products will be imported as drafts. You can review and publish them from Shopify Products.
            Set a custom internal SKU for each product, or accept the default.
          </Text>
          {rows.map((row) => (
            <InlineStack key={row.upc} gap="400" blockAlign="center">
              <div style={{ width: 48, flexShrink: 0 }}>
                <Thumbnail source={row.imageUrl || ""} alt={row.title} size="small" />
              </div>
              <BlockStack gap="100" inlineSize="fill">
                <Text as="span" variant="bodySm" fontWeight="semibold">{row.title}</Text>
                <Text as="span" variant="bodySm" tone="subdued">UPC: {row.upc}</Text>
              </BlockStack>
              <div style={{ width: 180 }}>
                <TextField
                  label="SKU"
                  value={
                    skuValues[row.upc] ??
                    (row.eldorado?.sku || row.honeysplace?.sku || row.nalpac?.sku || row.upc)
                  }
                  onChange={(v) => setSkuValues((prev) => ({ ...prev, [row.upc]: v }))}
                  autoComplete="off"
                />
              </div>
              <Checkbox
                label="Add to Favorites"
                checked={favoriteValues[row.upc] !== false}
                onChange={(v) => setFavoriteValues((prev) => ({ ...prev, [row.upc]: v }))}
              />
            </InlineStack>
          ))}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

// ─── Helper ───

async function getShopId(shopDomain: string): Promise<string> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) throw new Error("Shop not found");
  return shop.id;
}
