/**
 * IntimaSync - Product Detail Page
 * Shows product info from all suppliers: images, descriptions, pricing
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useNavigate } from "@remix-run/react";
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
import { useState } from "react";

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

export default function ProductDetailPage() {
  const { upc, match, canonical, suppliers } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>(
    canonical?.images?.slice(0, 10) || []
  );
  const [chosenDesc, setChosenDesc] = useState<string>(
    Object.keys(suppliers)[0] || ""
  );

  const supplierList = Object.values(suppliers) as any[];
  const allImages = supplierList.flatMap((s: any) => s.images || []);
  const uniqueImages = [...new Set(allImages)];

  const supplierLabel: Record<string, string> = {
    eldorado: "Eldorado",
    honeysplace: "Honey's Place",
    nalpac: "Nalpac",
  };

  const handleDownloadImages = () => {
    window.location.href = `/app/products/download-images?upcs=${upc}`;
  };

  return (
    <Page
      backAction={{ content: "Products", url: "/app/products" }}
      title={canonical?.title || upc}
      subtitle={`UPC: ${upc}`}
      primaryAction={{
        content: match.shopifyProductId ? "Already in Shopify" : "Import to Shopify",
        disabled: !!match.shopifyProductId,
        onAction: () => setImportOpen(true),
      }}
      secondaryActions={[
        {
          content: "Download All Images (.zip)",
          onAction: handleDownloadImages,
        },
      ]}
    >
      <Layout>
        {match.shopifyProductId && (
          <Layout.Section>
            <Banner tone="success" title="This product is in your Shopify store">
              <Button
                url={`https://${window.location.hostname.replace("admin.", "")}/admin/products/${match.shopifyProductId}`}
                target="_blank"
                variant="plain"
              >
                View in Shopify
              </Button>
            </Banner>
          </Layout.Section>
        )}

        {/* Image Gallery */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Images ({uniqueImages.length} across all suppliers)</Text>
              <Divider />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {uniqueImages.slice(0, 20).map((img: string) => (
                  <a key={img} href={img} target="_blank" rel="noreferrer">
                    <Thumbnail source={img} alt="Product image" size="large" />
                  </a>
                ))}
                {uniqueImages.length === 0 && (
                  <Text as="p" tone="subdued">No images available</Text>
                )}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Pricing by Supplier */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Pricing by Supplier</Text>
              <Divider />
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
                headings={["Supplier", "Cost", "MSRP", "In Stock", "SKU"]}
                rows={supplierList.map((s: any) => [
                  supplierLabel[s.supplier] || s.supplier,
                  s.cost != null ? `$${Number(s.cost).toFixed(2)}` : "â",
                  s.msrp != null ? `$${Number(s.msrp).toFixed(2)}` : "â",
                  s.qty ?? "â",
                  s.sku || "â",
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Descriptions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Descriptions</Text>
              <Divider />
              {supplierList.map((s: any) => (
                <BlockStack key={s.supplier} gap="200">
                  <Text as="h3" variant="headingSm">
                    {supplierLabel[s.supplier] || s.supplier}
                  </Text>
                  <Text as="p" tone={s.description ? undefined : "subdued"}>
                    {s.description || "No description available from this supplier."}
                  </Text>
                  <Divider />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Product Info */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Product Details</Text>
              <Divider />
              {canonical?.manufacturer && (
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">Brand</Text>
                  <Text as="span">{canonical.manufacturer}</Text>
                </InlineStack>
              )}
              {canonical?.category && (
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">Category</Text>
                  <Text as="span">{canonical.category}</Text>
                </InlineStack>
              )}
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">UPC</Text>
                <Text as="span">{upc}</Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">Suppliers</Text>
                <Text as="span">{supplierList.length}</Text>
              </InlineStack>
              {match.lockedSupplier && (
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">Locked Supplier</Text>
                  <Badge>{supplierLabel[match.lockedSupplier] || match.lockedSupplier}</Badge>
                </InlineStack>
              )}
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
                  description: suppliers[chosenDesc]?.description || "",
                  images: selectedImages,
                  sku: upc,
                },
              ])
            );
            fetch("/app/products/import", { method: "POST", body: formData }).then(() => {
              setImportOpen(false);
              navigate("/app/products");
            });
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setImportOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Choose description to import</Text>
              {supplierList.map((s: any) => (
                <label key={s.supplier} style={{ display: "flex", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="desc"
                    value={s.supplier}
                    checked={chosenDesc === s.supplier}
                    onChange={() => setChosenDesc(s.supplier)}
                  />
                  <Text as="span">{supplierLabel[s.supplier] || s.supplier}</Text>
                </label>
              ))}
            </BlockStack>
            <Divider />
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Select images ({selectedImages.length} selected)</Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {uniqueImages.slice(0, 20).map((img: string) => {
                  const checked = selectedImages.includes(img);
                  return (
                    <div
                      key={img}
                      onClick={() =>
                        setSelectedImages((prev) =>
                          checked ? prev.filter((i) => i !== img) : [...prev, img]
                        )
                      }
                      style={{
                        cursor: "pointer",
                        border: checked ? "2px solid #008060" : "2px solid transparent",
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
