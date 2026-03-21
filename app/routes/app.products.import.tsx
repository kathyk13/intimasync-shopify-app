/**
 * IntimaSync - Product Import to Shopify
 * Handles the actual creation of Shopify products from supplier data
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface ImportItem {
  upc: string;
  sku: string;
  addToFavorites: boolean;
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent !== "import_products") {
    return json({ error: "Invalid intent" });
  }

  const products: ImportItem[] = JSON.parse(String(formData.get("products") || "[]"));
  const results: { upc: string; success: boolean; shopifyProductId?: string; error?: string }[] = [];

  for (const item of products) {
    try {
      const match = await prisma.productMatch.findFirst({
        where: { shopId: shop.id, upc: item.upc },
      });
      if (!match) {
        results.push({ upc: item.upc, success: false, error: "Product match not found" });
        continue;
      }

      // Gather product data from all available suppliers
      const supplierData = await gatherProductData(shop.id, match);
      if (!supplierData) {
        results.push({ upc: item.upc, success: false, error: "No supplier data found" });
        continue;
      }

      // Collect all images from all suppliers (deduplicated)
      const allImages = await gatherAllImages(shop.id, match);

      // Create Shopify product via GraphQL Admin API
      const mutation = `
        mutation CreateProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
          productCreate(input: $input, media: $media) {
            product {
              id
              variants(first: 1) {
                nodes {
                  id
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const productInput: any = {
        title: supplierData.title,
        descriptionHtml: supplierData.description || "",
        status: "DRAFT",
        vendor: supplierData.manufacturer || "",
        productType: supplierData.category || "",
        tags: buildTags(supplierData, match),
        variants: [
          {
            sku: item.sku,
            barcode: item.upc,
            price: supplierData.msrp ? String(supplierData.msrp.toFixed(2)) : "0.00",
            inventoryManagement: "SHOPIFY",
            requiresShipping: true,
            weight: supplierData.weight || undefined,
            weightUnit: "POUNDS",
          },
        ],
        metafields: [
          {
            namespace: "intimasync",
            key: "upc",
            value: item.upc,
            type: "single_line_text_field",
          },
          {
            namespace: "intimasync",
            key: "default_supplier",
            value: match.defaultSupplier || "",
            type: "single_line_text_field",
          },
          {
            namespace: "intimasync",
            key: "eldorado_sku",
            value: match.eldoradoSku || "",
            type: "single_line_text_field",
          },
          {
            namespace: "intimasync",
            key: "honeysplace_sku",
            value: match.honeysplaceSku || "",
            type: "single_line_text_field",
          },
          {
            namespace: "intimasync",
            key: "nalpac_sku",
            value: match.nalpacSku || "",
            type: "single_line_text_field",
          },
        ],
      };

      // Add product dimensions if available
      if (supplierData.dimensions) {
        const dims = supplierData.dimensions;
        if (dims.height) productInput.variants[0].metafields = [
          ...(productInput.variants[0].metafields || []),
          { namespace: "intimasync", key: "height", value: dims.height, type: "single_line_text_field" },
        ];
      }

      // Media: use image URLs from suppliers
      const media = allImages.slice(0, 10).map((url: string) => ({
        mediaContentType: "IMAGE",
        originalSource: url,
        alt: supplierData.title,
      }));

      const response = await admin.graphql(mutation, {
        variables: { input: productInput, media: media.length > 0 ? media : undefined },
      });

      const data = await response.json();
      const errors = data.data?.productCreate?.userErrors;

      if (errors && errors.length > 0) {
        results.push({ upc: item.upc, success: false, error: errors[0].message });
        continue;
      }

      const shopifyProductId = data.data?.productCreate?.product?.id;
      const shopifyVariantId = data.data?.productCreate?.product?.variants?.nodes?.[0]?.id;

      // Update product match
      await prisma.productMatch.update({
        where: { id: match.id },
        data: {
          shopifyProductId,
          shopifyVariantId,
          internalSku: item.sku,
          isFavorite: item.addToFavorites,
          importedAt: new Date(),
        },
      });

      results.push({ upc: item.upc, success: true, shopifyProductId });
    } catch (err) {
      results.push({ upc: item.upc, success: false, error: String(err) });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  return json({
    success: true,
    message: `${successCount}/${results.length} products imported successfully`,
    results,
  });
}

// ─── Helpers ───

async function gatherProductData(shopId: string, match: any) {
  // Prefer the default supplier's data
  const preferredOrder = [
    match.defaultSupplier,
    "eldorado",
    "honeysplace",
    "nalpac",
  ].filter(Boolean);

  for (const supplier of preferredOrder) {
    const sku = match[`${supplier}Sku`];
    if (!sku) continue;
    const product = await prisma.supplierProduct.findFirst({
      where: { shopId, supplier, supplierSku: sku },
    });
    if (product) {
      return {
        title: product.title,
        description: product.description,
        msrp: product.msrp,
        cost: product.cost,
        category: product.category,
        manufacturer: product.manufacturer,
        images: product.imagesJson ? JSON.parse(product.imagesJson) : [],
        weight: null,
        dimensions: product.dimensionsJson ? JSON.parse(product.dimensionsJson) : null,
        supplier,
      };
    }
  }
  return null;
}

async function gatherAllImages(shopId: string, match: any): Promise<string[]> {
  const allImages: string[] = [];
  const suppliers = ["eldorado", "honeysplace", "nalpac"];

  for (const supplier of suppliers) {
    const sku = match[`${supplier}Sku`];
    if (!sku) continue;
    const product = await prisma.supplierProduct.findFirst({
      where: { shopId, supplier, supplierSku: sku },
    });
    if (product?.imagesJson) {
      const images = JSON.parse(product.imagesJson) as string[];
      images.forEach((img) => {
        if (img && !allImages.includes(img)) {
          allImages.push(img);
        }
      });
    }
  }

  return allImages;
}

function buildTags(supplierData: any, match: any): string[] {
  const tags: string[] = [];
  if (supplierData.category) tags.push(supplierData.category);
  if (supplierData.manufacturer) tags.push(supplierData.manufacturer);
  if (match.eldoradoSku) tags.push("eldorado");
  if (match.honeysplaceSku) tags.push("honeysplace");
  if (match.nalpacSku) tags.push("nalpac");
  tags.push("intimasync");
  return tags;
}
