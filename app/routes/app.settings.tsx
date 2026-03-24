/**
 * IntimaSync - Settings Page
 * Supplier credentials, shipping methods, fulfillment priority
 * Cards always open, equal height, buttons anchored at bottom
 */

import { useState, useRef } from "react";
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
  Collapsible,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { SHIPPING_CODES as HP_SHIPPING } from "../lib/suppliers/honeysplace.server";
import { SHIPPING_CODES as ELD_SHIPPING } from "../lib/suppliers/eldorado.server";
import { SHIPPING_METHODS as NALPAC_SHIPPING } from "../lib/suppliers/nalpac.server";

// âââ Loader âââ
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

  const priorityRaw = (shop as any).fulfillmentPriority || '["honeysplace","eldorado","nalpac","ecn"]';
  let fulfillmentPriority: string[];
  try { fulfillmentPriority = JSON.parse(priorityRaw); }
  catch { fulfillmentPriority = ["honeysplace", "eldorado", "nalpac", "ecn"]; }

  // Ensure all suppliers present (SexToyDistributing removed)
  const allSuppliers = ["honeysplace", "eldorado", "nalpac", "ecn"];
  for (const s of allSuppliers) {
    if (!fulfillmentPriority.includes(s)) fulfillmentPriority.push(s);
  }
  // Remove SexToyDistributing if still in saved priority list
  fulfillmentPriority = fulfillmentPriority.filter(s => allSuppliers.includes(s));

  const consolidationThreshold = (shop as any).consolidationThreshold ?? 10;

  return json({
    eldorado: credMap.eldorado || null,
    honeysplace: credMap.honeysplace || null,
    nalpac: credMap.nalpac || null,
    ecn: credMap.ecn || null,
    hpShippingOptions: HP_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    eldShippingOptions: ELD_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    nalpacShippingOptions: NALPAC_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    fulfillmentPriority,
    consolidationThreshold,
  });
}

// âââ Action âââ
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const supplier = String(formData.get("supplier") || "");
  const intent = String(formData.get("intent"));

  if (intent === "save_fulfillment_priority") {
    const priority = String(formData.get("priority"));
    const threshold = parseInt(String(formData.get("threshold") || "10"), 10);
    await (prisma.shop as any).update({
      where: { id: shop.id },
      data: { fulfillmentPriority: priority, consolidationThreshold: threshold },
    });
    return json({ success: true, message: "Fulfillment settings saved." });
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
      credentials.feedUrl = String(formData.get("feedUrl") || "");
    } else if (supplier === "nalpac") {
      credentials.username = String(formData.get("username") || "");
      credentials.password = String(formData.get("password") || "");
    } else if (supplier === "ecn") {
      credentials.username = String(formData.get("username") || "");
      credentials.password = String(formData.get("password") || "");
      credentials.accountId = String(formData.get("accountId") || "");
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
};

// âââ FAQ content per supplier âââ
const supplierFAQ: Record<string, { question: string; answer: string }[]> = {
  honeysplace: [
    {
      question: "Where do I find my Account Number?",
      answer: "Log in to honeysplace.com and go to My Account. Your account number is displayed at the top of the page.",
    },
    {
      question: "Where do I find my API Token?",
      answer: "In your Honey's Place account, navigate to My Account > Data Integration > API Setup. Your API token is listed there.",
    },
    {
      question: "Where do I find my Data Feed Token?",
      answer: "In your Honey's Place account, navigate to My Account > Data Integration > Data Feeds. The token appears in the feed URL after '?token='.",
    },
  ],
  eldorado: [
    {
      question: "Where do I find my API Key?",
      answer: "Contact your Eldorado account rep to receive your store-specific API key. Note: the key is IP-locked to your server's IP address.",
    },
    {
      question: "Where do I find my Account ID?",
      answer: "Your Account ID is visible on your Eldorado invoices and account portal at eldorado.net.",
    },
    {
      question: "Where do I find my SFTP credentials?",
      answer: "Contact Eldorado support or your account rep to request SFTP access for catalog data feeds.",
    },
  ],
  nalpac: [
    {
      question: "Where do I find my Nalpac credentials?",
      answer: "Use the same username and password you use to log in to nalpac.com. If you don't have an account, apply at nalpac.com/apply.",
    },
  ],
  ecn: [
    {
      question: "Where do I find my ECN credentials?",
      answer: "Use the username, password, and account ID from your East Coast News wholesale account at ecnwholesale.com.",
    },
  ],
};

// âââ Component âââ
export default function SettingsPage() {
  const {
    eldorado, honeysplace, nalpac, ecn,
    hpShippingOptions, eldShippingOptions, nalpacShippingOptions,
    fulfillmentPriority,
    consolidationThreshold,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const [priority, setPriority] = useState<string[]>(fulfillmentPriority);
  const [threshold, setThreshold] = useState(String(consolidationThreshold));
  const dragSrc = useRef<number | null>(null);

  const savePriority = () => {
    const formData = new FormData();
    formData.append("intent", "save_fulfillment_priority");
    formData.append("priority", JSON.stringify(priority));
    formData.append("threshold", threshold);
    submit(formData, { method: "POST" });
  };

  // Drag-and-drop handlers
  const handleDragStart = (index: number) => { dragSrc.current = index; };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragSrc.current === null || dragSrc.current === index) return;
    const next = [...priority];
    const [moved] = next.splice(dragSrc.current, 1);
    next.splice(index, 0, moved);
    dragSrc.current = index;
    setPriority(next);
  };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); dragSrc.current = null; };

  return (
    <Page title="Settings" subtitle="Configure your supplier connections and preferences">
      <Layout>
        {/* Supplier Cards */}
        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", alignItems: "stretch" }}>
            <SupplierSection supplier="honeysplace" title="Honey's Place" subtitle="honeysplace.com" existing={honeysplace} shippingOptions={hpShippingOptions}
              faq={supplierFAQ.honeysplace}
              fields={[
                { name: "account", label: "Account Number", type: "text", placeholder: "01234" },
                { name: "apiToken", label: "API Token", type: "password", placeholder: "From My Account > Data Integration > API Setup" },
                { name: "feedToken", label: "Data Feed Token", type: "text", placeholder: "From the data feed URL" },
              { name: "feedUrl", label: "Full Feed URL (optional)", type: "text", placeholder: "Paste complete URL from My Account > Data Integration > Data Feeds" },
              ]}
            />
            <SupplierSection supplier="eldorado" title="Eldorado" subtitle="eldorado.net" existing={eldorado} shippingOptions={eldShippingOptions}
              faq={supplierFAQ.eldorado}
              fields={[
                { name: "key", label: "API Key", type: "password", placeholder: "Your store-specific key (IP-locked)" },
                { name: "accountId", label: "Account ID", type: "text", placeholder: "e.g. 1234A" },
                { name: "sftpUsername", label: "SFTP Username", type: "text" },
                { name: "sftpPassword", label: "SFTP Password", type: "password" },
              ]}
            />
            <SupplierSection supplier="nalpac" title="Nalpac" subtitle="nalpac.com" existing={nalpac} shippingOptions={nalpacShippingOptions}
              faq={supplierFAQ.nalpac}
              fields={[
                { name: "username", label: "Username", type: "text" },
                { name: "password", label: "Password", type: "password" },
              ]}
            />
            <SupplierSection supplier="ecn" title="East Coast News" subtitle="ecnwholesale.com" existing={ecn} shippingOptions={[]}
              faq={supplierFAQ.ecn}
              fields={[
                { name: "username", label: "Username", type: "text" },
                { name: "password", label: "Password", type: "password" },
                { name: "accountId", label: "Account ID", type: "text" },
              ]}
            />
          </div>
        </Layout.Section>

        {/* Fulfillment Priority + Threshold */}
        <Layout.Section>
          <div style={{ maxWidth: "400px" }}>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Fulfillment Priority</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Drag to reorder. When two suppliers share the lowest price, IntimaSync routes to the highest-ranked supplier with stock.
                  </Text>
                </BlockStack>
                <Divider />

                {/* Draggable list */}
                <BlockStack gap="200">
                  {priority.map((sup, i) => (
                    <div
                      key={sup}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDrop={handleDrop}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "8px 10px",
                        background: "#f6f6f7",
                        borderRadius: "8px",
                        cursor: "grab",
                        userSelect: "none",
                      }}
                    >
                      {/* Drag handle */}
                      <span style={{ color: "#8c9196", fontSize: "18px", lineHeight: 1, cursor: "grab" }}>â ¿</span>
                      <Text as="span" variant="bodySm" tone="subdued">{i + 1}.</Text>
                      <Text as="span" fontWeight="semibold">{supplierLabels[sup] || sup}</Text>
                    </div>
                  ))}
                </BlockStack>

                <Divider />

                {/* Consolidation threshold */}
                <BlockStack gap="100">
                  <TextField
                    label="Consolidation threshold (%)"
                    type="number"
                    value={threshold}
                    onChange={setThreshold}
                    helpText="If a higher-priority supplier's price is within this % of the lowest price, route to them instead."
                    min="0"
                    max="100"
                    suffix="%"
                    autoComplete="off"
                  />
                </BlockStack>

                <Button variant="primary" onClick={savePriority}>Save Fulfillment Settings</Button>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// âââ Supplier Section (always open, flex height) âââ
function SupplierSection({
  supplier, title, subtitle, existing, fields, shippingOptions, faq,
}: {
  supplier: string;
  title: string;
  subtitle: string;
  existing: any;
  fields: { name: string; label: string; type: string; placeholder?: string }[];
  shippingOptions: { label: string; value: string }[];
  faq: { question: string; answer: string }[];
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
  const [faqOpen, setFaqOpen] = useState(false);

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

            {/* Credential FAQ */}
            {faq && faq.length > 0 && (
              <Box>
                <Button
                  variant="plain"
                  onClick={() => setFaqOpen(!faqOpen)}
                  ariaExpanded={faqOpen}
                >
                  {faqOpen ? "Hide credential help" : "Where do I find these credentials?"}
                </Button>
                <Collapsible open={faqOpen} id={`faq-${supplier}`} transition={{ duration: "200ms" }}>
                  <Box paddingBlockStart="300">
                    <BlockStack gap="300">
                      {faq.map((item, idx) => (
                        <BlockStack key={idx} gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{item.question}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">{item.answer}</Text>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  </Box>
                </Collapsible>
              </Box>
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
