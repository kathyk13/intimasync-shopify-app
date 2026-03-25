/**
 * IntimaSync - Product Detail Page
 * Shows product info from all suppliers: images, descriptions, pricing
 */
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useNavigate, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Thumbnail,
  Divider,
  DataTable,
  Banner,
  Modal,
  Checkbox,
} from "@shopify/polaris";
import { ArrowLeftIcon, ImportIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect, useCallback } from "react";

const PLACEHOLDER =
  "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_small.png";

/** Renders an <img> that falls back to a placeholder on load error. */
function SafeImage({ src, alt, size }: { src: string; alt: string; size: number }) {
  const [errored, setErrored] = useState(false);
  const handleError = useCallback(() => setErrored(true), []);
  if (errored) return null; // hide broken images entirely
  return (
    <img
      src={src}
      alt={alt}
      onError={handleError}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        borderRadius: "8px",
        border: "1px solid #e1e3e5",
        background: "#f6f6f7",
      }}
    />
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Error("Shop not found");

  const upc = params.upc!;

  const match = await prisma.productMatch.findFirst({
    where: { shopId: shop.id, upc },
  });
  if (!match) {
    throw new Response("Product not found", { status: 404 });
  }

  const supplierProducts = await prisma.supplierProduct.findMany({
    where: { shopId: shop.id, upc },
  });

  const bySupplier: Record<string, any> = {};
  for (const sp of supplierProducts) {
    bySupplier[sp.supplier] = {
      supplier: sp.supplier,
      sku: sp.supplierSku,
      title: sp.title,
      description: sp.description,
      cost: sp.cost,
      msrp: sp.msrp,
      qty: sp.inventoryQty,
      category: sp.category,
      manufacturer: sp.manufacturer,
      images: sp.imagesJson ? JSON.parse(sp.imagesJson) : [],
    };
  }

  // Prefer the first supplier's images/title as canonical
  const canonical =
    bySupplier.eldorado || bySupplier.honeysplace || bySupplier.nalpac || null;

  return json({
    upc,
    match: {
      isFavorite: match.isFavorite,
      shopifyProductId: match.shopifyProductId,
      lockedSupplier: match.lockedSupplier,
    },
    canonical,
    suppliers: bySupplier,
  });
}

// FIX P2.2: Action handler for authenticated operations including image URL retrieval.
// Using a server action avoids the Shopify embedded-app auth issue caused by
// window.location.href navigating the parent frame.
export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });
  if (!shop) throw new Error("Shop not found");

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const upc = params.upc!;

  if (intent === "get_image_urls") {
    const supplierProducts = await prisma.supplierProduct.findMany({
      where: { shopId: shop.id, upc },
      select: { imagesJson: true },
    });
    const allImages: string[] = [];
    for (const sp of supplierProducts) {
      if (sp.imagesJson) {
        const imgs = JSON.parse(sp.imagesJson) as string[];
        allImages.push(...imgs);
      }
    }
    const unique = [...new Set(allImages)];
    return json({ imageUrls: unique });
  }

  return json({ ok: false, error: "Unknown intent" });
}

export default function ProductDetailPage() {
  const { upc, match, canonical, suppliers } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ imageUrls?: string[] }>();

  const [importOpen, setImportOpen] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>(
    canonical?.images?.slice(0, 10) || []
  );
  const [chosenDesc, setChosenDesc] = useState<string>(
    Object.keys(suppliers)[0] || ""
  );

  const supplierList = Object.values(suppliers) as any[];
  const allImages = supplierList.flatMap((s: any) => s.images || []);
  const uniqueImages = [...new Set(allImages)] as string[];

  const supplierLabel: Record<string, string> = {
    eldorado: "Eldorado",
    honeysplace: "Honey's Place",
    nalpac: "Nalpac",
  };

  // FIX P2.2: Trigger individual browser downloads once we have image URLs back
  // from the authenticated action. This avoids the Shopify embedded auth error
  // that occurred when navigating to a separate route via window.location.href.
  useEffect(() => {
    if (fetcher.data?.imageUrls && fetcher.data.imageUrls.length > 0) {
      fetcher.data.imageUrls.forEach((url: string, i: number) => {
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = url;
          a.download = `product_${upc}_image_${i + 1}.jpg`;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, i * 200);
      });
    }
  }, [fetcher.data, upc]);

  const handleDownloadImages = () => {
    fetcher.submit({ intent: "get_image_urls" }, { method: "POST" });
  };

  return (
    <Page
      backAction={{ content: "Products", url: "/app/products" }}
      title={canonical?.title || upc}
      subtitle={`UPC: ${upc}`}
      primaryAction={{
        content: match.shopifyProductId
          ? "Already in Shopify"
          : "Import to Shopify",
        disabled: !!match.shopifyProductId,
        onAction: () => setImportOpen(true),
      }}
      secondaryActions={[
        {
          content:
            fetcher.state === "submitting"
              ? "Preparing download..."
              : "Download All Images",
          loading: fetcher.state === "submitting",
          onAction: handleDownloadImages,
          disabled: uniqueImages.length === 0,
        },
      ]}
    >
      <Layout>
        {match.shopifyProductId && (
          <Layout.Section>
            <Banner tone="success" title="This product is in your Shopify store">
              <Button
                url={`https://${
                  typeof window !== "undefined"
                    ? window.location.hostname.replace("admin.", "")
                    : ""
                }/admin/products/${match.shopifyProductId}`}
                target="_blank"
                variant="plain"
              >
                View in Shopify
              </Button>
            </Banner>
          </Layout.Section>
        )}

        {/* Product Info */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Product Details
              </Text>
              <Divider />
              {canonical?.manufacturer && (
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    Brand
                  </Text>
                  <Text as="span">{canonical.manufacturer}</Text>
                </InlineStack>
              )}
              {canonical?.category && (
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    Category
                  </Text>
                  <Text as="span">{canonical.category}</Text>
                </InlineStack>
              )}
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  UPC
                </Text>
                <Text as="span">{upc}</Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  Suppliers
                </Text>
                <Text as="span">{supplierList.length}</Text>
              </InlineStack>
              {match.lockedSupplier && (
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    Locked Supplier
                  </Text>
                  <Badge>
                    {supplierLabel[match.lockedSupplier] ||
                      match.lockedSupplier}
                  </Badge>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        {/* Pricing by Supplier */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Pricing by Supplier
              </Text>
              <Divider />
              {/* FIX P2.4: Use "\u2014" unicode escape for em dash to avoid
                  UTF-8/Latin-1 encoding artifacts that rendered as "ÃÂ¢Ã¢ÂÂ¬" */}
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                  "text",
                ]}
                headings={["Supplier", "Cost", "MSRP", "In Stock", "SKU"]}
                rows={supplierList.map((s: any) => [
                  supplierLabel[s.supplier] || s.supplier,
                  s.cost != null
                    ? `$${Number(s.cost).toFixed(2)}`
                    : "\u2014",
                  s.msrp != null
                    ? `$${Number(s.msrp).toFixed(2)}`
                    : "\u2014",
                  s.qty != null ? s.qty : "\u2014",
                  s.sku || "\u2014",
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Descriptions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Descriptions
              </Text>
              <Divider />
              {supplierList.map((s: any) => (
                <BlockStack key={s.supplier} gap="200">
                  <Text as="h3" variant="headingSm">
                    {supplierLabel[s.supplier] || s.supplier}
                  </Text>
                  {/* FIX P2.3: Use dangerouslySetInnerHTML so HTML tags like
                      <br><br> in supplier descriptions render as actual line
                      breaks instead of appearing as raw text */}
                  {s.description ? (
                    <div
                      style={{ color: "var(--p-color-text)", fontSize: "var(--p-font-size-300)", lineHeight: "var(--p-font-line-height-2)" }}
                      dangerouslySetInnerHTML={{ __html: s.description }}
                    />
                  ) : (
                    <Text as="p" tone="subdued">
                      No description available from this supplier.
                    </Text>
                  )}
                  <Divider />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Image Gallery */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Images ({uniqueImages.length} across all suppliers)
              </Text>
              <Divider />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {uniqueImages.slice(0, 20).map((img: string) => (
                  <a key={img} href={img} target="_blank" rel="noreferrer">
                    <SafeImage src={img} alt="Product image" size={120} />
                  </a>
                ))}
                {uniqueImages.length === 0 && (
                  <Text as="p" tone="subdued">
                    No images available. Run a catalog sync to fetch product images from suppliers.
                  </Text>
                )}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>

      {/* Import Modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import to Shopify"
        primaryAction={{
          content: "Import as Draft",
          onAction: () => {
            const formData = new FormData();
            formData.append("intent", "import_products");
            formData.append(
              "products",
              JSON.stringify([
                {
                  upc,
                  description:
                    suppliers[chosenDesc]?.description || "",
                  images: selectedImages,
                  sku: upc,
                },
              ])
            );
            fetch("/app/products/import", {
              method: "POST",
              body: formData,
            }).then(() => {
              setImportOpen(false);
              navigate("/app/products");
            });
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setImportOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Choose description to import
              </Text>
              {supplierList.map((s: any) => (
                <label
                  key={s.supplier}
                  style={{ display: "flex", gap: "8px", cursor: "pointer" }}
                >
                  <input
                    type="radio"
                    name="desc"
                    value={s.supplier}
                    checked={chosenDesc === s.supplier}
                    onChange={() => setChosenDesc(s.supplier)}
                  />
                  <Text as="span">
                    {supplierLabel[s.supplier] || s.supplier}
                  </Text>
                </label>
              ))}
            </BlockStack>
            <Divider />
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Select images ({selectedImages.length} selected)
              </Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {uniqueImages.slice(0, 20).map((img: string) => {
                  const checked = selectedImages.includes(img);
                  return (
                    <div
                      key={img}
                      onClick={() =>
                        setSelectedImages((prev) =>
                          checked
                            ? prev.filter((i) => i !== img)
                            : [...prev, img]
                        )
                      }
                      style={{
                        cursor: "pointer",
                        border: checked
                          ? "2px solid #008060"
                          : "2px solid transparent",
                        borderRadius: "4px",
                      }}
                    >
                      <Thumbnail source={img} alt="Select" size="medium" />
                    </div>
                  );
                })}
              </div>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
