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
  Icon,
  Tooltip,
  InlineStack,
  BlockStack,
  Select,
  Modal,
  TextField,
  Banner,
  Popover,
  ChoiceList,
} from "@shopify/polaris";
import { LockIcon, StarIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// --- Types ---
const PLACEHOLDER_IMG =
  "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_small.png";

/** Image with broken-URL fallback to placeholder */
function SafeThumbnail({ src, alt, size }: { src: string | null; alt: string; size: "small" | "large" }) {
  const [imgSrc, setImgSrc] = useState(src || PLACEHOLDER_IMG);
  const px = size === "large" ? 120 : 40;
  return (
    <img
      src={imgSrc}
      alt={alt}
      onError={() => setImgSrc(PLACEHOLDER_IMG)}
      style={{ width: px, height: px, objectFit: "contain", borderRadius: "4px", background: "#f6f6f7" }}
    />
  );
}

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

// âââ Loader âââ
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  let shopId: string;
  try {
    shopId = await getShopId(session.shop);
  } catch {
    console.error("Products loader: shop not found for", session.shop);
    return json({
      rows: [],
      total: 0,
      page: 1,
      perPage: 50,
      enabledSuppliers: [],
      categories: [],
      search: "",
      category: "",
      supplierFilter: "",
      inStockOnly: false,
      favoritesOnly: false,
      hasRunningSync: false,
      runningSupplier: null,
      dbError: true,
    });
  }

  try {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = parseInt(url.searchParams.get("perPage") || "50");
  const search = url.searchParams.get("search") || "";
  const category = url.searchParams.get("category") || ""; // comma-separated for multi-select
  const supplierFilter = url.searchParams.get("supplier") || "";
  const inStockOnly = url.searchParams.get("inStock") === "true";
  const favoritesOnly = url.searchParams.get("favorites") === "true";

  const credentials = await prisma.supplierCredential.findMany({
    where: { shopId, enabled: true },
    select: { supplier: true },
  });
  const enabledSuppliers = credentials.map((c) => c.supplier);

  // Build where clause
  const where: any = { shopId };
  if (favoritesOnly) where.isFavorite = true;

  // Apply search/category/supplier/inStock filter via supplier products
  let filteredUpcs: string[] | null = null;
  if (search || category || supplierFilter || inStockOnly) {
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
      const cats = category.split(",").map((c) => c.trim()).filter(Boolean);
      if (cats.length === 1) {
        spWhere.category = { equals: cats[0], mode: "insensitive" };
      } else if (cats.length > 1) {
        spWhere.category = { in: cats, mode: "insensitive" };
      }
    }
    if (supplierFilter) {
      spWhere.supplier = supplierFilter;
    }
    if (inStockOnly) {
      spWhere.inventoryQty = { gt: 0 };
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
          ? { sku: eldoradoProduct.supplierSku, cost: eldoradoProduct.cost ?? null, qty: eldoradoProduct.inventoryQty }
          : null,
        honeysplace: honeysplaceProduct
          ? { sku: honeysplaceProduct.supplierSku, cost: honeysplaceProduct.cost ?? null, qty: honeysplaceProduct.inventoryQty }
          : null,
        nalpac: nalpacProduct
          ? { sku: nalpacProduct.supplierSku, cost: nalpacProduct.cost ?? null, qty: nalpacProduct.inventoryQty }
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

  // Check for any currently-running sync
  const runningSync = await prisma.syncLog.findFirst({
    where: { shopId, status: "running" },
    orderBy: { startedAt: "desc" },
  });

  return json({
    rows,
    total,
    page,
    perPage,
    enabledSuppliers,
    categories,
    search,
    category,
    supplierFilter,
    inStockOnly,
    favoritesOnly,
    hasRunningSync: !!runningSync,
    runningSupplier: runningSync?.supplier ?? null,
    dbError: false,
  });
  } catch (err) {
    console.error("Products loader error:", err);
    return json({
      rows: [],
      total: 0,
      page: 1,
      perPage: 50,
      enabledSuppliers: [],
      categories: [],
      search: "",
      category: "",
      supplierFilter: "",
      inStockOnly: false,
      favoritesOnly: false,
      hasRunningSync: false,
      runningSupplier: null,
      dbError: true,
    });
  }
}

// âââ Action âââ
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

// âââ Component âââ
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
    supplierFilter: initialSupplierFilter,
    inStockOnly: initialInStockOnly,
    favoritesOnly: initialFavoritesOnly,
    hasRunningSync,
    runningSupplier,
    dbError,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [selectedUpcs, setSelectedUpcs] = useState<string[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"spreadsheet" | "thumbnail">("spreadsheet");
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [categoryValues, setCategoryValues] = useState<string[]>(
    initialCategory ? initialCategory.split(",").filter(Boolean) : []
  );
  const [categoryPopoverActive, setCategoryPopoverActive] = useState(false);
  const [supplierValue, setSupplierValue] = useState(initialSupplierFilter);
  const [inStockValue, setInStockValue] = useState(initialInStockOnly ? "true" : "");
  const [favoritesValue, setFavoritesValue] = useState(initialFavoritesOnly ? "true" : "");
  const [currentPerPage, setCurrentPerPage] = useState(String(perPage));

  const supplierLabels: Record<string, string> = {
    eldorado: "Eldorado",
    honeysplace: "Honey's Place",
    nalpac: "Nalpac",
  };

  const categoryParam = categoryValues.join(",");
  const applyFilters = (params: Record<string, string>) => {
    const sp = new URLSearchParams({
      page: "1",
      perPage: currentPerPage,
      search: searchValue,
      category: params.category !== undefined ? params.category : categoryParam,
      supplier: supplierValue,
      inStock: inStockValue,
      favorites: favoritesValue,
      ...params,
    });
    navigate(`/app/products?${sp.toString()}`);
  };

  const handleSearch = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  const handleSearchSubmit = () => {
    applyFilters({ search: searchValue });
  };

  const hasActiveFilters = !!(searchValue || categoryValues.length > 0 || supplierValue || inStockValue || favoritesValue);

  const handleClearSearch = () => {
    setSearchValue("");
    setCategoryValues([]);
    setSupplierValue("");
    setInStockValue("");
    setFavoritesValue("");
    applyFilters({ search: "", category: "", supplier: "", inStock: "", favorites: "" });
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


  const formatCost = (
    cost: number | null | undefined,
    qty: number | null | undefined,
    isCheapest: boolean,
    isLocked: boolean
  ) => {
    // null cost or qty means this supplier doesn't carry the item at all
    if (cost == null || qty == null)
      return <Text as="span" tone="subdued">—</Text>;
    // qty=0 means out of stock — show price subdued so it's visible but not misleading
    if (qty === 0)
      return <Text as="span" tone="subdued">${cost.toFixed(2)}</Text>;
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
    { title: "" },
    { title: "Product" },
    { title: "MSRP" },
    ...(enabledSuppliers.includes("eldorado") ? [{ title: "Eldorado $" }, { title: "Eld. Qty" }] : []),
    ...(enabledSuppliers.includes("honeysplace") ? [{ title: "HP $" }, { title: "HP Qty" }] : []),
    ...(enabledSuppliers.includes("nalpac") ? [{ title: "Nalpac $" }, { title: "Nalpac Qty" }] : []),
  ];

  const rowMarkup = rows.map((row, index) => {
    const cheapest = cheapestSupplier(row);
    const isSelected = selectedUpcs.includes(row.upc);

    return (
      <IndexTable.Row
        id={row.upc}
        key={row.upc}
        selected={isSelected}
        position={index}
      >
        <IndexTable.Cell>
          <SafeThumbnail src={row.imageUrl} alt={row.title} size="small" />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
            <Tooltip content={row.isFavorite ? "Remove from favorites" : "Add to favorites"}>
              <Button
                variant="plain"
                onClick={() => {
                  const formData = new FormData();
                  formData.append("intent", "toggle_favorite");
                  formData.append("upc", row.upc);
                  fetcher.submit(formData, { method: "POST" });
                }}
                icon={StarIcon}
                tone={row.isFavorite ? "critical" : undefined}
              />
            </Tooltip>
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div style={{ maxWidth: "260px" }}>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="start" wrap>
              <span onClick={(e) => e.stopPropagation()} style={{ wordBreak: "break-word", whiteSpace: "normal" }}>
                <Link to={`/app/products/${row.upc}`}>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {row.title}
                  </Text>
                </Link>
              </span>
              {row.shopifyProductId && (
                <Tooltip content="Imported to Shopify">
                  <Badge tone="success">In Shopify</Badge>
                </Tooltip>
              )}
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">{row.upc}</Text>
          </BlockStack>
          </div>
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
          <BlockStack gap="400">
          {dbError && (
            <Banner
              tone="critical"
              title="Product data unavailable"
              action={{ content: "Go to Sync", url: "/app/sync" }}
              secondaryAction={{ content: "Check Settings", url: "/app/settings" }}
            >
              There was a problem loading product data. Sync your catalog or check that your supplier credentials are saved.
            </Banner>
          )}

          {hasRunningSync && (
            <Banner tone="info" title="Sync in progress">
              {runningSupplier && runningSupplier !== "all"
                ? `${supplierLabels[runningSupplier] || runningSupplier} catalog sync is running. Pricing and inventory may be incomplete — please refresh in a few minutes.`
                : "An inventory sync is running. Data shown may be slightly out of date — please refresh in a few minutes."}
            </Banner>
          )}

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
            <BlockStack gap="300">
              {/* Row 1: search + view toggle */}
              <InlineStack gap="200" blockAlign="end" wrap>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSearchSubmit(); }}
                  style={{ display: "flex", gap: "8px", flex: "1", minWidth: "280px", alignItems: "flex-end" }}
                >
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Search"
                      labelHidden
                      value={searchValue}
                      onChange={handleSearch}
                      placeholder="Search by title, UPC, brand, description..."
                      autoComplete="off"
                      clearButton
                      onClearButtonClick={() => { setSearchValue(""); applyFilters({ search: "" }); }}
                    />
                  </div>
                  <Button submit>Search</Button>
                </form>

                {hasActiveFilters && (
                  <Button variant="plain" onClick={handleClearSearch}>Clear filters</Button>
                )}

                <ButtonGroup variant="segmented">
                  <Button pressed={viewMode === "spreadsheet"} onClick={() => setViewMode("spreadsheet")}>Table</Button>
                  <Button pressed={viewMode === "thumbnail"} onClick={() => setViewMode("thumbnail")}>Grid</Button>
                </ButtonGroup>
              </InlineStack>

              {/* Row 2: filter selects */}
              <InlineStack gap="200" blockAlign="end" wrap>
                {enabledSuppliers.length > 1 && (
                  <div style={{ minWidth: "160px" }}>
                    <Select
                      label="Supplier"
                      options={[
                        { label: "All suppliers", value: "" },
                        ...enabledSuppliers.map((s) => ({ label: supplierLabels[s] || s, value: s })),
                      ]}
                      value={supplierValue}
                      onChange={(v) => { setSupplierValue(v); applyFilters({ supplier: v }); }}
                    />
                  </div>
                )}

                {categories.length > 0 && (
                  <div style={{ minWidth: "180px" }}>
                    <Popover
                      active={categoryPopoverActive}
                      activator={
                        <Button
                          onClick={() => setCategoryPopoverActive((v) => !v)}
                          disclosure
                        >
                          {categoryValues.length === 0
                            ? "All categories"
                            : `${categoryValues.length} categor${categoryValues.length === 1 ? "y" : "ies"}`}
                        </Button>
                      }
                      onClose={() => setCategoryPopoverActive(false)}
                      preferredAlignment="left"
                    >
                      <div style={{ maxHeight: "300px", overflow: "auto", padding: "8px" }}>
                        <ChoiceList
                          title="Categories"
                          titleHidden
                          allowMultiple
                          choices={categories.map((c) => ({ label: c, value: c }))}
                          selected={categoryValues}
                          onChange={(selected) => {
                            setCategoryValues(selected);
                            applyFilters({ category: selected.join(",") });
                          }}
                        />
                      </div>
                    </Popover>
                  </div>
                )}

                <div style={{ minWidth: "150px" }}>
                  <Select
                    label="Stock status"
                    options={[
                      { label: "All products", value: "" },
                      { label: "In stock only", value: "true" },
                    ]}
                    value={inStockValue}
                    onChange={(v) => { setInStockValue(v); applyFilters({ inStock: v }); }}
                  />
                </div>

                <Button
                  pressed={favoritesValue === "true"}
                  onClick={() => {
                    const next = favoritesValue === "true" ? "" : "true";
                    setFavoritesValue(next);
                    applyFilters({ favorites: next });
                  }}
                  icon={StarIcon}
                >
                  Favorites
                </Button>

                <div style={{ minWidth: "120px" }}>
                  <Select
                    label="Per page"
                    options={[
                      { label: "25 per page", value: "25" },
                      { label: "50 per page", value: "50" },
                      { label: "100 per page", value: "100" },
                    ]}
                    value={currentPerPage}
                    onChange={(v) => { setCurrentPerPage(v); applyFilters({ perPage: v, page: "1" }); }}
                  />
                </div>
              </InlineStack>
            </BlockStack>
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
                      <div style={{ position: "relative" }}>
                        <Link to={`/app/products/${row.upc}`}>
                          <div style={{ display: "flex", justifyContent: "center", padding: "8px" }}>
                            <SafeThumbnail src={row.imageUrl} alt={row.title} size="large" />
                          </div>
                        </Link>
                        <div style={{ position: "absolute", top: "4px", right: "4px" }}>
                          <Button
                            variant="plain"
                            onClick={() => {
                              const formData = new FormData();
                              formData.append("intent", "toggle_favorite");
                              formData.append("upc", row.upc);
                              fetcher.submit(formData, { method: "POST" });
                            }}
                            icon={StarIcon}
                            tone={row.isFavorite ? "critical" : undefined}
                          />
                        </div>
                      </div>
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
          </BlockStack>
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

// âââ Import Modal âââ
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
                <SafeThumbnail src={row.imageUrl} alt={row.title} size="small" />
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

// âââ Helper âââ
async function getShopId(shopDomain: string): Promise<string> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) throw new Error("Shop not found");
  return shop.id;
}
