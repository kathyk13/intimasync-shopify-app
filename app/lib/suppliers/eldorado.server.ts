/**
 * Eldorado CIPP (Customer Integration Partner Portal) Integration
 * Revised 5/2025 - SFTP-based, replacing legacy REST API at eldoradopartner.com
 *
 * SFTP server: 52.27.75.88
 * Folders:
 *   /feeds/                 - product data files (daily, ~9pm Mountain)
 *   /inventory/             - inventory + pricing files (hourly)
 *   /shipping_confirmations/ - shipment confirmations (every 2h, rolling 7 days)
 *   /uploads/               - drop order XML files here (one file per order)
 */

import { NodeSSH } from "node-ssh";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Types Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export interface EldoradoCredentials {
  accountId: string;          // Business partner # assigned by Eldorado (e.g. 49679PF)
  sftpUsername: string;       // SFTP username
  sftpPassword: string;       // SFTP password
  sftpHost?: string;          // Defaults to 52.27.75.88
  remoteFeedPath?: string;    // Remote path to product feed TSV, defaults to /feeds/product_feed.tsv
  inventoryGroup?: string;    // Discount group code for Inventory_#group files (e.g. "cga0a")
}

export interface EldoradoProduct {
  model: string;
  name: string;
  quantity: number;
  description: string;
  price: number;
  msrp?: string;
  brandName?: string;
  upc?: string;
  height?: string;
  length?: string;
  diameter?: string;
  weight?: number;
  manufacturer?: string;
  color?: string;
  packaging?: string;
  productClass?: string;
  materials: string[];
  textures: string[];
  fragrance?: string;
  flavor?: string;
  size?: string;
  ounces?: string;
  functions: string[];
  features: string[];
  images: string[];
  discontinued: boolean;
  closeout: boolean;
  hazardous: boolean;
  mapEnabled: boolean;
  mapPrice?: string;
  prop65Warning: boolean;
  insertableLength?: string;
  totalLength?: string;
}

export interface EldoradoInventoryItem {
  model: string;
  quantity: number;
  price: number;
}

export interface EldoradoOrderProduct {
  code: string;
  quantity: number;
}

export interface EldoradoOrderRequest {
  sourceOrderNumber: string;
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;
  zipCode: string;
  countryCode: string;
  phoneNumber: string;
  shipVia: string;
  specialInstructions?: string;
  signatureRequired?: boolean;
  products: EldoradoOrderProduct[];
}

export interface EldoradoOrderResponse {
  success: boolean;
  filename?: string;
  error?: string;
}

export interface EldoradoShipmentConfirmation {
  webOrderNumber?: string;
  sourceOrderNumber?: string;
  carrierMethod?: string;
  trackingNumber?: string;
  dateShipped?: string;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ SFTP connection helper Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

const SFTP_HOST = "52.27.75.88";
const SFTP_PORT = 22;

async function withSftp<T>(
  credentials: EldoradoCredentials,
  fn: (ssh: NodeSSH) => Promise<T>
): Promise<T> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: credentials.sftpHost || SFTP_HOST,
      port: SFTP_PORT,
      username: credentials.sftpUsername,
      password: credentials.sftpPassword,
      readyTimeout: 15000,
    });
    return await fn(ssh);
  } finally {
    ssh.dispose();
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Validate Credentials Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function validateCredentials(
  credentials: EldoradoCredentials
): Promise<{ valid: boolean; error?: string }> {
  if (!credentials.sftpUsername || !credentials.sftpPassword) {
    return { valid: false, error: "SFTP username and password are required." };
  }
  const feedPath = credentials.remoteFeedPath || "/feeds/product_feed.tsv";
  try {
    await withSftp(credentials, async (ssh) => {
      console.log(`[eldorado] validateCredentials: checking ${feedPath} on ${credentials.sftpHost || SFTP_HOST}`);
      // Check the specific feed file exists
      const result = await ssh.execCommand(`ls "${feedPath}"`);
      if (result.stderr && result.stderr.includes("No such file")) {
        throw new Error(
          `Login succeeded but feed file not found: ${feedPath}. ` +
          `Eldorado drops this file daily around 9 PM Mountain time. ` +
          `Check the path or try again after the daily drop.`
        );
      }
      if (result.stderr && !result.stdout) {
        throw new Error(`SFTP error checking file: ${result.stderr.trim()}`);
      }
      console.log(`[eldorado] validateCredentials: file confirmed at ${feedPath}`);
    });
    return { valid: true };
  } catch (error) {
    const msg = String(error);
    if (msg.includes("All configured authentication") || msg.includes("auth") || msg.includes("password")) {
      return { valid: false, error: `Authentication failed. Check your SFTP username and password.` };
    }
    return { valid: false, error: msg };
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Place Order Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function placeOrder(
  credentials: EldoradoCredentials,
  order: EldoradoOrderRequest
): Promise<EldoradoOrderResponse> {
  const productsXml = order.products
    .map(
      (p) =>
        `  <Product>\n    <Code>${p.code}</Code>\n    <Quantity>${p.quantity}</Quantity>\n  </Product>`
    )
    .join("\n");

  const parts = [
    `<AccountId>${credentials.accountId}</AccountId>`,
    `<Name>${order.name.substring(0, 50)}</Name>`,
    `<AddressLine1>${order.addressLine1.substring(0, 100)}</AddressLine1>`,
    order.addressLine2
      ? `<AddressLine2>${order.addressLine2.substring(0, 100)}</AddressLine2>`
      : "",
    `<City>${order.city.substring(0, 100)}</City>`,
    `<StateCode>${order.stateCode.substring(0, 3)}</StateCode>`,
    `<ZipCode>${order.zipCode.substring(0, 20)}</ZipCode>`,
    `<CountryCode>${order.countryCode.substring(0, 3)}</CountryCode>`,
    `<PhoneNumber>${order.phoneNumber.replace(/\D/g, "").substring(0, 20)}</PhoneNumber>`,
    `<ShipVia>${order.shipVia}</ShipVia>`,
    order.specialInstructions
      ? `<SpecialInstructions>${order.specialInstructions.substring(0, 254)}</SpecialInstructions>`
      : "",
    `<SourceOrderNumber>${order.sourceOrderNumber}</SourceOrderNumber>`,
    order.signatureRequired ? `<signatureRequired>Y</signatureRequired>` : "",
    `<Products>\n${productsXml}\n</Products>`,
  ];

  const xml = parts.filter(Boolean).join("\n");
  const filename = `order_${order.sourceOrderNumber}_${Date.now()}.xml`;
  const tmpDir = await mkdtemp(join(tmpdir(), "eldorado-order-"));
  const localPath = join(tmpDir, filename);

  try {
    await writeFile(localPath, xml, "utf-8");
    await withSftp(credentials, async (ssh) => {
      await ssh.putFile(localPath, `/uploads/${filename}`);
    });
    return { success: true, filename };
  } catch (error) {
    return { success: false, error: String(error) };
  } finally {
    await unlink(localPath).catch(() => {});
  }
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Get Inventory Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function getInventory(
  credentials: EldoradoCredentials
): Promise<Map<string, EldoradoInventoryItem>> {
  const inventory = new Map<string, EldoradoInventoryItem>();

  await withSftp(credentials, async (ssh) => {
    let inventoryFile: string;

    if (credentials.inventoryGroup) {
      inventoryFile = `/inventory/inventory_${credentials.inventoryGroup}.csv`;
    } else {
      // Discover the file by listing the directory
      const result = await ssh.execCommand("ls /inventory/");
      const files = result.stdout.trim().split("\n").filter(Boolean);
      const invFile = files.find(
        (f) => f.includes("inventory_") && f.endsWith(".csv")
      );
      if (!invFile) throw new Error("No inventory CSV found in /inventory/");
      inventoryFile = `/inventory/${invFile.trim()}`;
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "eldorado-inv-"));
    const localPath = join(tmpDir, "inventory.csv");

    try {
      await ssh.getFile(localPath, inventoryFile);
      const content = await readFile(localPath, "utf-8");
      const lines = content.split("\n");

      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const [model, quantity, price] = line.split(",");
        if (model) {
          inventory.set(model.trim(), {
            model: model.trim(),
            quantity: parseInt(quantity?.trim() || "0", 10),
            price: parseFloat(price?.trim() || "0"),
          });
        }
      }
    } finally {
      await unlink(localPath).catch(() => {});
    }
  });

  return inventory;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Check Stock Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function checkStock(
  credentials: EldoradoCredentials,
  model: string
): Promise<number> {
  const inventory = await getInventory(credentials);
  return inventory.get(model)?.quantity ?? 0;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Get Shipment Confirmations Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function getShipmentConfirmations(
  credentials: EldoradoCredentials
): Promise<EldoradoShipmentConfirmation[]> {
  const confirmations: EldoradoShipmentConfirmation[] = [];

  await withSftp(credentials, async (ssh) => {
    const result = await ssh.execCommand("ls /shipping_confirmations/");
    const files = result.stdout
      .trim()
      .split("\n")
      .filter((f) => f.trim());

    for (const file of files) {
      const remotePath = `/shipping_confirmations/${file.trim()}`;
      const tmpDir = await mkdtemp(join(tmpdir(), "eldorado-ship-"));
      const localPath = join(tmpDir, file.trim());

      try {
        await ssh.getFile(localPath, remotePath);
        const content = await readFile(localPath, "utf-8");

        const get = (tag: string) => {
          const m = new RegExp(`<${tag}>([^<]*)<\/${tag}>`).exec(content);
          return m ? m[1].trim() : undefined;
        };

        confirmations.push({
          webOrderNumber: get("WebOrderNumber") || get("Web_Order_Number"),
          sourceOrderNumber:
            get("SourceOrderNumber") || get("Supplier_Order_Number"),
          carrierMethod: get("CarrierMethod") || get("Carrier_Method"),
          trackingNumber: get("TrackingNumber") || get("Tracking_Number"),
          dateShipped: get("DateShipped") || get("Date_Shipped"),
        });
      } finally {
        await unlink(localPath).catch(() => {});
      }
    }
  });

  return confirmations;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Parse Product Feed (TSV) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export function parseProductFeedTsv(content: string): EldoradoProduct[] {
  const lines = content.split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map((h) => h.trim().toLowerCase());

  const get = (row: string[], key: string): string => {
    const idx = headers.indexOf(key.toLowerCase());
    return idx >= 0 ? row[idx]?.trim() || "" : "";
  };

  const products: EldoradoProduct[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");
    if (row.length < 2) continue;
    const model = get(row, "products_model");
    if (!model) continue;

    const materials = [
      get(row, "prop_material_0"),
      get(row, "prop_material_1"),
      get(row, "prop_material_2"),
    ].filter(Boolean);

    const textures = [
      get(row, "prop_texture_0"),
      get(row, "prop_texture_1"),
      get(row, "prop_texture_2"),
    ].filter(Boolean);

    const functions = [
      get(row, "prop_function_1"),
      get(row, "prop_function_2"),
      get(row, "prop_function_3"),
    ].filter(Boolean);

    const features = [
      get(row, "features_value_0"),
      get(row, "features_value_1"),
      get(row, "features_value_2"),
    ].filter(Boolean);

    // Primary image + up to 4 variant suffixes (a, b, c, d)
    const imageBase = "https://www.eldorado.net/images/large";
    const images = [`${imageBase}/${model}.jpg`];
    ["a", "b", "c", "d"].forEach((s) => images.push(`${imageBase}/${model}${s}.jpg`));

    products.push({
      model,
      name: get(row, "products_name"),
      quantity: parseInt(get(row, "products_quantity") || "0", 10),
      description: get(row, "products_description"),
      price: parseFloat(get(row, "products_price") || "0"),
      msrp: get(row, "msrp") || undefined,
      brandName: get(row, "item_brandname") || undefined,
      upc: get(row, "item_upc") || undefined,
      height: get(row, "item_height") || undefined,
      length: get(row, "item_length") || undefined,
      diameter: get(row, "item_diameter") || undefined,
      weight: parseFloat(get(row, "products_weight") || "0") || undefined,
      manufacturer: get(row, "manufacturers_name") || undefined,
      color: get(row, "prop_color") || undefined,
      packaging: get(row, "prop_packaging") || undefined,
      productClass: get(row, "product_class") || undefined,
      materials,
      textures,
      fragrance: get(row, "prop_fragrance") || undefined,
      flavor: get(row, "prop_flavor") || undefined,
      size: get(row, "prop_size") || undefined,
      ounces: get(row, "prop_ounces") || undefined,
      functions,
      features,
      images,
      discontinued: get(row, "discontinued") === "1",
      closeout: get(row, "closeout") === "1",
      hazardous: get(row, "hazardous_material") === "1",
      mapEnabled: get(row, "map_enabled") === "1",
      mapPrice: get(row, "map_price") || undefined,
      prop65Warning: get(row, "prop_65 warning") === "1",
      insertableLength: get(row, "insertable_length") || undefined,
      totalLength: get(row, "item_total_length") || undefined,
    });
  }

  return products;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Download Product Feed from SFTP Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export async function downloadProductFeed(
  credentials: EldoradoCredentials
): Promise<EldoradoProduct[]> {
  if (!credentials.sftpUsername || !credentials.sftpPassword) {
    throw new Error(
      "Eldorado SFTP credentials are not configured. " +
      "Go to Settings > Eldorado and enter your SFTP username and password."
    );
  }

  const remotePath = credentials.remoteFeedPath || "/feeds/product_feed.tsv";
  const host = credentials.sftpHost || SFTP_HOST;
  console.log(`[eldorado] downloadProductFeed: connecting to ${host}`);

  const tmpDir = await mkdtemp(join(tmpdir(), "eldorado-feed-"));
  const localPath = join(tmpDir, "product_feed.tsv");

  try {
    await withSftp(credentials, async (ssh) => {
      console.log(`[eldorado] downloadProductFeed: authenticated successfully`);
      console.log(`[eldorado] downloadProductFeed: downloading ${remotePath}`);

      const downloaded = await ssh.getFile(localPath, remotePath);
      if (downloaded === false) {
        // Check if the file actually exists to give a better error
        const check = await ssh.execCommand(`ls "${remotePath}"`);
        if (check.stderr && check.stderr.includes("No such file")) {
          throw new Error(
            `Feed file not found at ${remotePath}. ` +
            `Eldorado drops product_feed.tsv in /feeds/ daily around 9 PM Mountain time. ` +
            `Verify the path in Settings or wait for the next daily drop.`
          );
        }
        throw new Error(
          `Failed to download ${remotePath}. ` +
          `Your account may not have read permission for this file.`
        );
      }
      console.log(`[eldorado] downloadProductFeed: file downloaded successfully`);
    });

    console.log(`[eldorado] downloadProductFeed: parsing TSV`);
    const fileContent = await readFile(localPath, "utf-8");
    const products = parseProductFeedTsv(fileContent);
    console.log(`[eldorado] downloadProductFeed: parsed ${products.length} products`);
    return products;
  } finally {
    await unlink(localPath).catch(() => {});
  }
}

export async function checkQuantityBatch(
  credentials: EldoradoCredentials,
  models: string[]
): Promise<Map<string, number>> {
  const inventory = await getInventory(credentials);
  const result = new Map<string, number>();
  for (const model of models) {
    result.set(model, inventory.get(model)?.quantity ?? 0);
  }
  return result;
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Get Discounts Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
// In the CIPP system all pricing is embedded in the inventory CSV already.
// This returns an empty map so inventory-sync.server.ts applies no extra
// discount on top of the cost pulled from the CSV.

export async function getDiscounts(
  _credentials: EldoradoCredentials
): Promise<Map<string, number>> {
  return new Map<string, number>();
}

// Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂ Shipping Codes (updated for CIPP May 2025) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

export const SHIPPING_CODES = [
  { code: "B2CBR",  label: "Best Rate (Cheapest - M01, M02, FHD, UGR)" },
  { code: "B2CBRI", label: "Best Rate International" },
  { code: "BR1D",   label: "Best Rate 1 Day" },
  { code: "BR2D",   label: "Best Rate 2 Day" },
  { code: "F1DAR",  label: "FedEx Priority Overnight (Residential)" },
  { code: "F1DARS", label: "FedEx Priority Overnight Saturday (Residential)" },
  { code: "F1DPR",  label: "FedEx Standard Overnight (Residential)" },
  { code: "F1FR",   label: "FedEx First Overnight (Residential)" },
  { code: "F2DR",   label: "FedEx 2 Day Air (Residential)" },
  { code: "F2DSR",  label: "FedEx 2 Day Air Saturday (Residential)" },
  { code: "F3DR",   label: "FedEx Express Saver (Residential)" },
  { code: "FICP",   label: "FedEx International Connect Plus" },
  { code: "FIER",   label: "FedEx International Economy" },
  { code: "FIPR",   label: "FedEx International Priority" },
  { code: "FHD",    label: "FedEx Ground - USA / Canada / Mexico" },
  { code: "FOR",    label: "FedEx One Rate (2-day guarantee)" },
  { code: "M01",    label: "USPS Ground Advantage (3-7 days)" },
  { code: "M02",    label: "USPS Priority Mail (2-3 days)" },
  { code: "M03",    label: "USPS Express Mail (overnight)" },
  { code: "M13",    label: "USPS International Express Mail" },
  { code: "M14",    label: "USPS International Priority Mail" },
  { code: "M15",    label: "USPS International First Class Mail" },
  { code: "U1DAR",  label: "UPS Next Day Air Early AM (Residential)" },
  { code: "U1DPR",  label: "UPS Next Day Air Saver (Residential)" },
  { code: "U1DR",   label: "UPS Next Day Air (Residential)" },
  { code: "U1DRS",  label: "UPS Next Day Air Saturday (Residential)" },
  { code: "U2DR",   label: "UPS 2nd Day Air (Residential)" },
  { code: "U2DRS",  label: "UPS 2nd Day Air Saturday (Residential)" },
  { code: "U3DR",   label: "UPS 3 Day Select (Residential)" },
  { code: "UCSR",   label: "UPS Standard Canada (Residential)" },
  { code: "UGR",    label: "UPS Ground (Residential)" },
  { code: "UWEPR",  label: "UPS Worldwide Expedited (Residential)" },
  { code: "UWEXR",  label: "UPS Worldwide Express (Residential)" },
  { code: "UWSR",   label: "UPS Worldwide Saver (Residential)" },
];
