/**
 * IntimaSync - Shared Supplier Configuration
 * Single source of truth for all supplier definitions.
 * Import this wherever supplier lists are needed.
 *
 * To add a new supplier:
 *   1. Add it here with supportsSettings / supportsCatalogSync flags
 *   2. Create app/lib/suppliers/<id>.server.ts
 *   3. Wire into syncProductCatalog in inventory-sync.server.ts
 */

export interface SupplierDef {
  id: string;
  displayName: string;
  /** Whether this supplier has a Settings card (credentials, shipping, etc.) */
  supportsSettings: boolean;
  /** Whether this supplier has a working catalog sync implementation */
  supportsCatalogSync: boolean;
}

export const SUPPLIERS: SupplierDef[] = [
  {
    id: "honeysplace",
    displayName: "Honey's Place",
    supportsSettings: true,
    supportsCatalogSync: true,
  },
  {
    id: "eldorado",
    displayName: "Eldorado",
    supportsSettings: true,
    supportsCatalogSync: true,
  },
  {
    id: "nalpac",
    displayName: "Nalpac",
    supportsSettings: true,
    supportsCatalogSync: true,
  },
  // ECN: no catalog sync backend implemented yet.
  // Set supportsSettings + supportsCatalogSync to true when implementation is ready.
  {
    id: "ecn",
    displayName: "East Coast News",
    supportsSettings: false,
    supportsCatalogSync: false,
  },
];

/** Suppliers that appear in the Settings page */
export const SETTINGS_SUPPLIERS = SUPPLIERS.filter((s) => s.supportsSettings);

/** Suppliers that support catalog sync (Sync page + internal endpoint) */
export const CATALOG_SYNC_SUPPLIERS = SUPPLIERS.filter((s) => s.supportsCatalogSync);

/** Valid catalog sync supplier IDs as a runtime array */
export const CATALOG_SYNC_IDS = CATALOG_SYNC_SUPPLIERS.map((s) => s.id);

export type CatalogSyncSupplierId = "honeysplace" | "eldorado" | "nalpac";
