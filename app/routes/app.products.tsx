/**
 * IntimaSync - Products Layout
 * Parent layout for nested product routes (catalog, linked, favorites)
 */

import { Outlet } from "@remix-run/react";

export default function ProductsLayout() {
  return <Outlet />;
}
