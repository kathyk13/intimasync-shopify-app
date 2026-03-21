/**
 * IntimaSync - Favorites List
 * Shows only favorited products
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, EmptyState, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  const favorites = await prisma.productMatch.findMany({
    where: { shopId: shop.id, isFavorite: true },
  });
  return json({ count: favorites.length });
}

export default function FavoritesPage() {
  const { count } = useLoaderData<typeof loader>();

  if (count === 0) {
    return (
      <Page title="Favorites">
        <EmptyState
          heading="No favorites yet"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          action={{ content: "Browse Products", url: "/app/products" }}
        >
          <p>Star products in the Products view to add them to your favorites.</p>
        </EmptyState>
      </Page>
    );
  }

  // Reuse the main products page with favorites filter
  return (
    <Page
      title="Favorites"
      subtitle={`${count} favorited product${count !== 1 ? "s" : ""}`}
      primaryAction={{ content: "Browse All Products", url: "/app/products" }}
    >
      {/* Products table loaded with favorites=true filter */}
      <iframe
        src="/app/products?favorites=true"
        style={{ width: "100%", border: "none", minHeight: "600px" }}
        title="Favorites"
      />
    </Page>
  );
}
