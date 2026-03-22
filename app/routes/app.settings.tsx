/**
 * IntimaSync - Settings Page
 * Supplier credentials, shipping methods, fulfillment priority
 * Cards always open, equal height, buttons anchored at bottom
 */

import { useState } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  BlockStack,
  Text,
  Badge,
  Divider,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { SHIPPING_CODES as HP_SHIPPING } from "../lib/suppliers/honeysplace.server";
import { SHIPPING_CODES as ELD_SHIPPING } from "../lib/suppliers/eldorado.server";
import { SHIPPING_METHODS as NALPAC_SHIPPING } from "../lib/suppliers/nalpac.server";

// ─── Loader ───
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Error("Shop not found");

  const credentials = await prisma.supplierCredential.findMany({ where: { shopId: shop.id } });
  const credMap: Record<string, any> = {};
  credentials.forEach((c) => {
    const parsed = JSON.parse(c.credentialsEncrypted);
    credMap[c.supplier] = { ...parsed, enabled: c.enabled, defaultShippingCode: c.defaultShippingCode };
  });

  const priorityRaw = (shop as any).fulfillmentPriority || '["honeysplace","eldorado","nalpac","ecn","sextoydistributing"]';
  let fulfillmentPriority: string[];
  try { fulfillmentPriority = JSON.parse(priorityRaw); }
  catch { fulfillmentPriority = ["honeysplace", "eldorado", "nalpac", "ecn", "sextoydistributing"]; }

  const allSuppliers = ["honeysplace", "eldorado", "nalpac", "ecn", "sextoydistributing"];
  for (const s of allSuppliers) {
    if (!fulfillmentPriority.includes(s)) fulfillmentPriority.push(s);
  }

  return json({
    eldorado: credMap.eldorado || null,
    honeysplace: credMap.honeysplace || null,
    nalpac: credMap.nalpac || null,
    ecn: credMap.ecn || null,
    sextoydistributing: credMap.sextoydistributing || null,
    hpShippingOptions: HP_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    eldShippingOptions: ELD_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    nalpacShippingOptions: NALPAC_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    fulfillmentPriority,
  });
}

// ─── Action ───
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const supplier = String(formData.get("supplier") || "");
  const intent = String(formData.get("intent"));

  if (intent === "save_fulfillment_priority") {
    const priority = String(formData.get("priority"));
    await (prisma.shop as any).update({
      where: { id: shop.id },
      data: { fulfillmentPriority: priority },
    });
    return json({ success: true, message: "Fulfillment priority saved." });
  }

  if (intent === "save_credentials") {
    const credentials: Record<string, string> = {};
    if (supplier === "eldorado") {
      credentials.key = String(formData.get("key") || "");
      credentials.accountId = String(formData.get("accountId") || "");
      credentials.sftpUsername = String(formData.get("sftpUsername") || "");
      credentials.sftpPassword = String(formData.get("sftpPassword") || "");
    } else if (supplier === "honeysplace") {
      credentials.account = String(formData.get("account") || "");
      credentials.apiToken = String(formData.get("apiToken") || "");
      credentials.feedToken = String(formData.get("feedToken") || "");
    } else if (supplier === "nalpac") {
      credentials.username = String(formData.get("username") || "");
      credentials.password = String(formData.get("password") || "");
    } else if (supplier === "ecn") {
      credentials.username = String(formData.get("username") || "");
      credentials.password = String(formData.get("password") || "");
      credentials.accountId = String(formData.get("accountId") || "");
    } else if (supplier === "sextoydistributing") {
      credentials.username = String(formData.get("username") || "");
      credentials.password = String(formData.get("password") || "");
    }

    const defaultShippingCode = String(formData.get("defaultShippingCode") || "");
    const enabled = formData.get("enabled") === "true";

    await prisma.supplierCredential.upsert({
      where: { shopId_supplier: { shopId: shop.id, supplier } },
      create: { shopId: shop.id, supplier, credentialsEncrypted: JSON.stringify(credentials), defaultShippingCode: defaultShippingCode || null, enabled },
      update: { credentialsEncrypted: JSON.stringify(credentials), defaultShippingCode: defaultShippingCode || null, enabled },
    });
    return json({ success: true, message: `${supplier} credentials saved.` });
  }

  if (intent === "test_credentials") {
    const cred = await prisma.supplierCredential.findUnique({
      where: { shopId_supplier: { shopId: shop.id, supplier } },
    });
    if (!cred) return json({ success: false, error: "No credentials saved yet." });
    const parsed = JSON.parse(cred.credentialsEncrypted);
    let result: { valid: boolean; error?: string } = { valid: false };
    if (supplier === "honeysplace") {
      const { validateCredentials } = await import("../lib/suppliers/honeysplace.server");
      result = await validateCredentials(parsed);
    } else if (supplier === "eldorado") {
      const { validateCredentials } = await import("../lib/suppliers/eldorado.server");
      result = await validateCredentials(parsed);
    } else if (supplier === "nalpac") {
      const { validateCredentials } = await import("../lib/suppliers/nalpac.server");
      result = await validateCredentials(parsed);
    } else {
      result = { valid: true };
    }
    return json(result);
  }

  return json({ success: false, error: "Unknown intent" });
}

const supplierLabels: Record<string, string> = {
  eldorado: "Eldorado",
  honeysplace: "Honey's Place",
  nalpac: "Nalpac",
  ecn: "East Coast News",
  sextoydistributing: "SexToyDistributing",
};

// ─── Component ───
export default function SettingsPage() {
  const {
    eldorado, honeysplace, nalpac, ecn, sextoydistributing,
    hpShippingOptions, eldShippingOptions, nalpacShippingOptions,
    fulfillmentPriority,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const [priority, setPriority] = useState<string[]>(fulfillmentPriority);

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...priority];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setPriority(next);
  };
  const moveDown = (index: number) => {
    if (index === priority.length - 1) return;
    const next = [...priority];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setPriority(next);
  };
  const savePriority = () => {
    const formData = new FormData();
    formData.append("intent", "save_fulfillment_priority");
    formData.append("priority", JSON.stringify(priority));
    submit(formData, { method: "POST" });
  };

  return (
    <Page title="Settings" subtitle="Configure your supplier connections and preferences">
      <Layout>
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", alignItems: "stretch" }}>
            <SupplierSection supplier="honeysplace" title="Honey's Place" subtitle="honeysplace.com" existing={honeysplace} shippingOptions={hpShippingOptions}
              fields={[
                { name: "account", label: "Account Number", type: "text", placeholder: "01234" },
                { name: "apiToken", label: "API Token", type: "password", placeholder: "From My Account > Data Integration > API Setup" },
                { name: "feedToken", label: "Data Feed Token", type: "text", placeholder: "From the data feed URL" },
              ]}
            />
            <SupplierSection supplier="eldorado" title="Eldorado" subtitle="eldorado.net" existing={eldorado} shippingOptions={eldShippingOptions}
              fields={[
                { name: "key", label: "API Key", type: "password", placeholder: "Your store-specific key (IP-locked)" },
                { name: "accountId", label: "Account ID", type: "text", placeholder: "e.g. 1234A" },
                { name: "sftpUsername", label: "SFTP Username", type: "text" },
                { name: "sftpPassword", label: "SFTP Password", type: "password" },
              ]}
            />
            <SupplierSection supplier="nalpac" title="Nalpac" subtitle="nalpac.com" existing={nalpac} shippingOptions={nalpacShippingOptions}
              fields={[
                { name: "username", label: "Username", type: "text" },
                { name: "password", label: "Password", type: "password" },
              ]}
            />
            <SupplierSection supplier="ecn" title="East Coast News" subtitle="ecnwholesale.com" existing={ecn} shippingOptions={[]}
              fields={[
                { name: "username", label: "Username", type: "text" },
                { name: "password", label: "Password", type: "password" },
                { name: "accountId", label: "Account ID", type: "text" },
              ]}
            />
            <SupplierSection supplier="sextoydistributing" title="SexToyDistributing" subtitle="sextoydistributing.com" existing={sextoydistributing} shippingOptions={[]}
              fields={[
                { name: "username", label: "Username", type: "text" },
                { name: "password", label: "Password", type: "password" },
              ]}
            />
          </div>
        </Layout.Section>

        <Layout.Section>
          <div style={{ maxWidth: "360px" }}>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Fulfillment Priority</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    When two suppliers offer the same lowest price, IntimaSync routes to the highest-ranked supplier with stock.
                  </Text>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  {priority.map((sup, i) => (
                    <InlineStack key={sup} align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">{i + 1}.</Text>
                        <Text as="span" fontWeight="semibold">{supplierLabels[sup] || sup}</Text>
                      </InlineStack>
                      <InlineStack gap="100">
                        <Button size="slim" variant="plain" disabled={i === 0} onClick={() => moveUp(i)} accessibilityLabel="Move up">▲</Button>
                        <Button size="slim" variant="plain" disabled={i === priority.length - 1} onClick={() => moveDown(i)} accessibilityLabel="Move down">▼</Button>
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
                <Button variant="primary" onClick={savePriority}>Save Priority</Button>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// ─── Supplier Section (always open, flex height) ───
function SupplierSection({
  supplier, title, subtitle, existing, fields, shippingOptions,
}: {
  supplier: string;
  title: string;
  subtitle: string;
  existing: any;
  fields: { name: string; label: string; type: string; placeholder?: string }[];
  shippingOptions: { label: string; value: string }[];
}) {
  const submit = useSubmit();
  const [values, setValues] = useState<Record<string, string>>(
    existing
      ? Object.fromEntries(fields.map((f) => [f.name, existing[f.name] || ""]))
      : Object.fromEntries(fields.map((f) => [f.name, ""]))
  );
  const [shippingCode, setShippingCode] = useState(existing?.defaultShippingCode || "");
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSave = () => {
    setSaving(true);
    const formData = new FormData();
    formData.append("intent", "save_credentials");
    formData.append("supplier", supplier);
    formData.append("enabled", "true");
    formData.append("defaultShippingCode", shippingCode);
    fields.forEach((f) => formData.append(f.name, values[f.name] || ""));
    submit(formData, { method: "POST" });
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const formData = new FormData();
      formData.append("intent", "test_credentials");
      formData.append("supplier", supplier);
      const url = window.location.href.split("?")[0] + "?_data=routes%2Fapp.settings";
      const response = await fetch(url, { method: "POST", body: formData });
      const data = await response.json();
      setTestResult({ success: data.valid, message: data.valid ? "Connection successful!" : data.error || "Test failed" });
    } catch (err) {
      setTestResult({ success: false, message: "Test failed: " + String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Card>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">{title}</Text>
                  {existing?.enabled
                    ? <Badge tone="success">Connected</Badge>
                    : <Badge tone="attention">Not configured</Badge>
                  }
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">{subtitle}</Text>
              </BlockStack>
            </InlineStack>

            <Divider />

            <FormLayout>
              {fields.map((field) => (
                <TextField
                  key={field.name}
                  label={field.label}
                  type={field.type as any}
                  value={values[field.name] || ""}
                  placeholder={field.placeholder}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                  autoComplete="off"
                />
              ))}
              {shippingOptions.length > 0 && (
                <Select
                  label="Default Shipping Method"
                  options={[{ label: "Select shipping method...", value: "" }, ...shippingOptions]}
                  value={shippingCode}
                  onChange={setShippingCode}
                />
              )}
            </FormLayout>

            {testResult && (
              <Banner tone={testResult.success ? "success" : "critical"}>
                {testResult.message}
              </Banner>
            )}

            <div style={{ marginTop: "auto" }}>
              <InlineStack gap="200">
                <Button variant="primary" onClick={handleSave} loading={saving}>Save Credentials</Button>
                {existing && <Button onClick={handleTest} loading={testing}>Test Connection</Button>}
              </InlineStack>
            </div>
          </BlockStack>
        </div>
      </Card>
    </div>
  );
}
