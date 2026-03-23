/**
 * IntimaSync - Products Catalog Page
 * Spreadsheet + thumbnail views, search, category filter, per-page selector
 */

import { useState, useCallback } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher, Link, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Pagination,
  Thumbnail,
  Icon,
  Tooltip,
  InlineStack,
  BlockStack,
  Select,
  Modal,
  TextField,
  Banner,
} from "@shopify/polaris";
import { LockIcon, StarIcon, LayoutColumnsIcon, ListBulletedIcon } from "@shopify/polaris-icons";
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

  const credentials = await prisma.supplierCredential.findMany({
    where: { shopId, enabled: true },
    select: { supplier: true },
  });
  const enabledSuppliers = credentials.map((c) => c.supplier);

  // Build where clause
  const where: any = { shopId };
  if (favoritesOnly) where.isFavorite = true;

  // Apply search/category filter via supplier products
  let filteredUpcs: string[] | null = null;
  if (search || category) {
    const spWhere: any = { shopId };
    if (search) {
      spWhere.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { upc: { contains: search } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { supplierSku: { contains: search } },
      ];
    }
    if (category) {
      spWhere.category = { equals: category, mode: "insensitive" };
    }
    const matchingProducts = await prisma.supplierProduct.findMany({
      where: spWhere,
      select: { upc: true },
      distinct: ["upc"],
    });
    filteredUpcs = matchingProducts.map((p) => p.upc).filter(Boolean) as string[];
    where.upc = { in: filteredUpcs };
  }

  const [matches, total] = await Promise.all([
    prisma.productMatch.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.productMatch.count({ where }),
  ]);

  const rows: ProductRow[] = await Promise.all(
    matches.map(async (match) => {
      const [eldoradoProduct, honeysplaceProduct, nalpacProduct] =
        await Promise.all([
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

      const anyProduct = eldoradoProduct || honeysplaceProduct || nalpacProduct;
      const images = anyProduct?.imagesJson ? JSON.parse(anyProduct.imagesJson) : [];
      // Use trimmed title to avoid empty-string fallback issues
      const title = anyProduct?.title?.trim() || "Unknown Product";

      return {
        upc: match.upc,
        title,
        msrp: anyProduct?.msrp || null,
        imageUrl: images[0] || null,
        shopifyProductId: match.shopifyProductId,
        isFavorite: match.isFavorite,
        lockedSupplier: match.lockedSupplier,
        defaultSupplier: match.defaultSupplier,
        eldorado: eldoradoProduct
          ? { sku: eldoradoProduct.supplierSku, cost: eldoradoProduct.cost || 0, qty: eldoradoProduct.inventoryQty }
          : null,
        honeysplace: honeysplaceProduct
          ? { sku: honeysplaceProduct.supplierSku, cost: honeysplaceProduct.cost || 0, qty: honeysplaceProduct.inventoryQty }
          : null,
        nalpac: nalpacProduct
          ? { sku: nalpacProduct.supplierSku, cost: nalpacProduct.cost || 0, qty: nalpacProduct.inventoryQty }
          : null,
      };
    })
  );

  // Categories for filter
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
export default function ProductsIndexPage() {
  const {
    rows,
    total,
    page,
    perPage,
    enabledSuppliers,
    categories,
    search: initialSearch,
    category: initialCategory,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [selectedUpcs, setSelectedUpcs] = useState<string[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"spreadsheet" | "thumbnail">("spreadsheet");
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [categoryValue, setCategoryValue] = useState(initialCategory);
  const [currentPerPage, setCurrentPerPage] = useState(String(perPage));

  const applyFilters = (params: Record<string, string>) => {
    const sp = new URLSearchParams({
      page: "1",
      perPage: currentPerPage,
      search: searchValue,
      category: categoryValue,
      ...params,
    });
    navigate(`/app/products?${sp.toString()}`);
  };

  const handleSearch = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  const handleSearchSubmit = () => {
    applyFilters({ search: searchValue, category: categoryValue });
  };

  const handleClearSearch = () => {
    setSearchValue("");
    setCategoryValue("");
    applyFilters({ search: "", category: "" });
  };

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
    return (
      (row.eldorado?.qty || 0) + (row.honeysplace?.qty || 0) + (row.nalpac?.qty || 0) === 0
    );
  };

  const formatCost = (
    cost: number | null | undefined,
    qty: number | null | undefined,
    isCheapest: boolean,
    isLocked: boolean
  ) => {
    if (cost == null || qty == null)
      return <Text as="span" tone="subdued">—</Text>;
    if (qty === 0)
      return <Text as="span" tone="subdued">$0.00</Text>;
    return (
      <InlineStack gap="100" blockAlign="center">
        <Text
          as="span"
          tone={isCheapest ? "success" : undefined}
          fontWeight={isCheapest ? "bold" : undefined}
        >
          ${cost.toFixed(2)}
        </Text>
        {isLocked && (
          <Tooltip content="Supplier manually locked">
            <Icon source={LockIcon} tone="caution" />
          </Tooltip>
        )}
      </InlineStack>
    );
  };

  const headings = [
    { title: "" },
    { title: "Product" },
    { title: "UPC" },
    { title: "MSRP" },
    ...(enabledSuppliers.includes("eldorado") ? [{ title: "Eldorado $" }, { title: "Eld. Qty" }] : []),
    ...(enabledSuppliers.includes("honeysplace") ? [{ title: "HP $" }, { title: "HP Qty" }] : []),
    ...(enabledSuppliers.includes("nalpac") ? [{ title: "Nalpac $" }, { title: "Nalpac Qty" }] : []),
    { title: "Fulfillment" },
  ];

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
      >
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
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              {/* Stop propagation so clicking the link doesn't also select the row */}
              <span onClick={(e) => e.stopPropagation()}>
                <Link to={`/app/products/${row.upc}`}>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {row.title}
                  </Text>
                </Link>
              </span>
              {outOfStock && (
                <Badge tone="attention">OOS</Badge>
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
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">{row.upc}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span">{row.msrp ? `$${row.msrp.toFixed(2)}` : "—"}</Text>
        </IndexTable.Cell>
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
        {enabledSuppliers.includes("eldorado") && (
          <IndexTable.Cell>
            <Text as="span" tone={row.eldorado?.qty === 0 ? "subdued" : undefined}>
              {row.eldorado?.qty ?? "—"}
            </Text>
          </IndexTable.Cell>
        )}
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
        {enabledSuppliers.includes("honeysplace") && (
          <IndexTable.Cell>
            <Text as="span" tone={row.honeysplace?.qty === 0 ? "subdued" : undefined}>
              {row.honeysplace?.qty ?? "—"}
            </Text>
          </IndexTable.Cell>
        )}
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
        {enabledSuppliers.includes("nalpac") && (
          <IndexTable.Cell>
            <Text as="span" tone={row.nalpac?.qty === 0 ? "subdued" : undefined}>
              {row.nalpac?.qty ?? "—"}
            </Text>
          </IndexTable.Cell>
        )}
        <IndexTable.Cell>
          {/* Stop propagation so changing the dropdown doesn't select the row */}
          <div onClick={(e) => e.stopPropagation()}>
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
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

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

          {/* Toolbar */}
          <Card>
            <InlineStack gap="300" blockAlign="end" wrap>
              <div style={{ flex: "1", minWidth: "200px" }}>
                <TextField
                  label="Search"
                  labelHidden
                  value={searchValue}
                  onChange={handleSearch}
                  placeholder="Search by title, UPC, brand, description..."
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={handleClearSearch}
                />
              </div>

              {categories.length > 0 && (
                <div style={{ minWidth: "180px" }}>
                  <Select
                    label="Category"
                    labelHidden
                    options={[
                      { label: "All categories", value: "" },
                      ...categories.map((c) => ({ label: c, value: c })),
                    ]}
                    value={categoryValue}
                    onChange={(v) => {
                      setCategoryValue(v);
                      applyFilters({ category: v });
                    }}
                  />
                </div>
              )}

              <div style={{ minWidth: "120px" }}>
                <Select
                  label="Per page"
                  labelHidden
                  options={[
                    { label: "25 per page", value: "25" },
                    { label: "50 per page", value: "50" },
                    { label: "100 per page", value: "100" },
                  ]}
                  value={currentPerPage}
                  onChange={(v) => {
                    setCurrentPerPage(v);
                    applyFilters({ perPage: v, page: "1" });
                  }}
                />
              </div>

              <Button onClick={handleSearchSubmit}>Search</Button>
              {(searchValue || categoryValue) && (
                <Button variant="plain" onClick={handleClearSearch}>Clear</Button>
              )}

              <ButtonGroup variant="segmented">
                <Tooltip content="Spreadsheet view">
                  <Button
                    pressed={viewMode === "spreadsheet"}
                    onClick={() => setViewMode("spreadsheet")}
                    icon={ListBulletedIcon}
                    accessibilityLabel="Spreadsheet view"
                  />
                </Tooltip>
                <Tooltip content="Thumbnail view">
                  <Button
                    pressed={viewMode === "thumbnail"}
                    onClick={() => setViewMode("thumbnail")}
                    icon={LayoutColumnsIcon}
                    accessibilityLabel="Thumbnail view"
                  />
                </Tooltip>
              </ButtonGroup>
            </InlineStack>
          </Card>

          {/* Spreadsheet view */}
          {viewMode === "spreadsheet" && (
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
                bulkActions={[
                  {
                    content: "Import to Shopify",
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
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          )}

          {/* Thumbnail view */}
          {viewMode === "thumbnail" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "16px",
                marginTop: "16px",
              }}
            >
              {rows.map((row) => {
                const cheapest = cheapestSupplier(row);
                const cheapestCost = cheapest ? row[cheapest as keyof ProductRow] as any : null;
                return (
                  <Card key={row.upc}>
                    <BlockStack gap="200">
                      <Link to={`/app/products/${row.upc}`}>
                        <div style={{ display: "flex", justifyContent: "center", padding: "8px" }}>
                          <Thumbnail
                            source={
                              row.imageUrl ||
                              "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_small.png"
                            }
                            alt={row.title}
                            size="large"
                          />
                        </div>
                      </Link>
                      <BlockStack gap="100">
                        <Link to={`/app/products/${row.upc}`}>
                          <Text as="p" variant="bodySm" fontWeight="semibold" truncate>
                            {row.title}
                          </Text>
                        </Link>
                        {cheapest && cheapestCost?.cost != null && (
                          <Text as="p" variant="bodySm" tone="success">
                            From ${Number(cheapestCost.cost).toFixed(2)}
                          </Text>
                        )}
                        {row.msrp && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            MSRP ${row.msrp.toFixed(2)}
                          </Text>
                        )}
                        {row.shopifyProductId && <Badge tone="success" size="small">In Shopify</Badge>}
                        {cheapest && (
                          <Badge size="small">
                            {cheapest === "eldorado" ? "Eldorado" : cheapest === "honeysplace" ? "Honey's Place" : "Nalpac"}
                          </Badge>
                        )}
                      </BlockStack>
                      <Button
                        size="slim"
                        fullWidth
                        onClick={() => {
                          setSelectedUpcs([row.upc]);
                          setImportModalOpen(true);
                        }}
                        disabled={!!row.shopifyProductId}
                      >
                        {row.shopifyProductId ? "In Shopify" : "Import"}
                      </Button>
                    </BlockStack>
                  </Card>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => applyFilters({ page: String(page - 1) })}
              hasNext={page * perPage < total}
              onNext={() => applyFilters({ page: String(page + 1) })}
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

  const handleImport = () => {
    const formData = new FormData();
    formData.append("intent", "import_products");
    formData.append(
      "products",
      JSON.stringify(
        rows.map((row) => ({
          upc: row.upc,
          sku: skuValues[row.upc] || row.eldorado?.sku || row.honeysplace?.sku || row.nalpac?.sku || row.upc,
        }))
      )
    );
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
            Products will be imported as drafts. Set an optional internal SKU for
            each product. You can review and publish them from Shopify Products.
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
                  label="SKU (optional)"
                  value={skuValues[row.upc] ?? (row.eldorado?.sku || row.honeysplace?.sku || row.nalpac?.sku || "")}
                  onChange={(v) => setSkuValues((prev) => ({ ...prev, [row.upc]: v }))}
                  autoComplete="off"
                />
              </div>
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
