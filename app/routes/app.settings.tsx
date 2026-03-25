/**
 * IntimaSync - Settings Page
 * Supplier credentials, shipping methods, fulfillment priority
 * Cards always open, equal height, buttons anchored at bottom
 */

import { useState, useRef, useEffect } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useFetcher } from "@remix-run/react";
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

// --- Loader ---
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

  const priorityRaw = (shop as any).fulfillmentPriority || '["honeysplace","eldorado","nalpac"]';
  let fulfillmentPriority: string[];
  try { fulfillmentPriority = JSON.parse(priorityRaw); }
  catch { fulfillmentPriority = ["honeysplace", "eldorado", "nalpac"]; }

  // Keep only suppliers with active sync backends
  const activeSuppliers = ["honeysplace", "eldorado", "nalpac"];
  for (const s of activeSuppliers) {
    if (!fulfillmentPriority.includes(s)) fulfillmentPriority.push(s);
  }
  fulfillmentPriority = fulfillmentPriority.filter(s => activeSuppliers.includes(s));

  const consolidationThreshold = (shop as any).consolidationThreshold ?? 10;

  return json({
    eldorado: credMap.eldorado || null,
    honeysplace: credMap.honeysplace || null,
    nalpac: credMap.nalpac || null,
    hpShippingOptions: HP_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    eldShippingOptions: ELD_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    nalpacShippingOptions: NALPAC_SHIPPING.map((s) => ({ label: s.label, value: s.code })),
    fulfillmentPriority,
    consolidationThreshold,
  });
}

// --- Action ---
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
      credentials.accountId = String(formData.get("accountId") || "");
      credentials.sftpHost = String(formData.get("sftpHost") || "");
      credentials.sftpUsername = String(formData.get("sftpUsername") || "");
      credentials.sftpPassword = String(formData.get("sftpPassword") || "");
      credentials.remoteFeedPath = String(formData.get("remoteFeedPath") || "/feeds/product_feed.tsv");
    } else if (supplier === "honeysplace") {
      credentials.account = String(formData.get("account") || "");
      credentials.apiToken = String(formData.get("apiToken") || "");
      credentials.feedToken = String(formData.get("feedToken") || "");
      credentials.feedUrl = String(formData.get("feedUrl") || "");
    } else if (supplier === "nalpac") {
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
};

// --- FAQ content per supplier ---
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
      question: "Where do I find my Account ID?",
      answer: "Your Account ID is in Eldorado welcome emails and invoices. It may be labeled 'Customer ID' (numeric, e.g. 8960) or 'BP#' (e.g. 49679PF). Use the numeric Customer ID here.",
    },
    {
      question: "Where do I find my SFTP credentials?",
      answer: "Eldorado emails SFTP credentials when your CIPP dropship account is set up. Look for an email with 'Host: sftp://52.27.75.88' and your username/password. Contact your account rep if you have not received them.",
    },
    {
      question: "When will my product feed be available?",
      answer: "Eldorado says SFTP folders can take up to 24-48 hours to generate after initial CIPP account setup. The product feed is automatically fetched from /feeds/product_feed.tsv.",
    },
  ],
  nalpac: [
    {
      question: "Where do I find my Nalpac credentials?",
      answer: "Use the same username and password you use to log in to nalpac.com. If you don't have an account, apply at nalpac.com/apply.",
    },
  ],
};

// --- Component ---
export default function SettingsPage() {
  const {
    eldorado, honeysplace, nalpac,
    hpShippingOptions, eldShippingOptions, nalpacShippingOptions,
    fulfillmentPriority,
    consolidationThreshold,
  } = useLoaderData<typeof loader>();

  const submit = useSubmit();
  const priorityFetcher = useFetcher();
  const [priority, setPriority] = useState<string[]>(fulfillmentPriority);
  const [threshold, setThreshold] = useState(String(consolidationThreshold));
  const dragSrc = useRef<number | null>(null);
  const [prioritySaved, setPrioritySaved] = useState(false);

  // Track save result
  useEffect(() => {
    if (priorityFetcher.state === "idle" && priorityFetcher.data) {
      const data = priorityFetcher.data as any;
      if (data.success) setPrioritySaved(true);
    }
  }, [priorityFetcher.state, priorityFetcher.data]);

  const savePriority = () => {
    setPrioritySaved(false);
    const formData = new FormData();
    formData.append("intent", "save_fulfillment_priority");
    formData.append("priority", JSON.stringify(priority));
    formData.append("threshold", threshold);
    priorityFetcher.submit(formData, { method: "POST" });
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
                { name: "accountId", label: "Customer ID (numeric)", type: "text", placeholder: "e.g. 8960 (from Eldorado welcome email)" },
                { name: "sftpHost", label: "SFTP Host / IP", type: "text", placeholder: "52.27.75.88" },
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
                      <span style={{ color: "#8c9196", fontSize: "18px", lineHeight: 1, cursor: "grab" }}>{"\u2630"}</span>
                      <Text as="span" variant="bodySm" tone="subdued">{i + 1}.</Text>
                      <Text as="span" fontWeight="semibold">{supplierLabels[sup] || sup}</Text>
                    </div>
                  ))}
                </BlockStack>

                <Divider />

                {/* Consolidation threshold */}
                <BlockStack gap="100">
                  <TextField
                    label="Order Consolidation Threshold (%)"
                    type="number"
                    value={threshold}
                    onChange={setThreshold}
                    helpText="When one supplier can fulfill at least this % of a customer's line items, route as many items as possible to that supplier to reduce split shipments. Items only available elsewhere are still split-shipped."
                    min="0"
                    max="100"
                    suffix="%"
                    autoComplete="off"
                  />
                </BlockStack>

                {prioritySaved && (
                  <Banner tone="success">
                    Fulfillment settings saved.
                  </Banner>
                )}

                <Button variant="primary" onClick={savePriority} loading={priorityFetcher.state !== "idle"}>Save Fulfillment Settings</Button>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// --- Supplier Section (always open, flex height) ---
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
  const saveFetcher = useFetcher();
  const testFetcher = useFetcher();

  const [values, setValues] = useState<Record<string, string>>(
    existing
      ? Object.fromEntries(fields.map((f) => [f.name, existing[f.name] || ""]))
      : Object.fromEntries(fields.map((f) => [f.name, ""]))
  );
  const [shippingCode, setShippingCode] = useState(existing?.defaultShippingCode || "");
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [faqOpen, setFaqOpen] = useState(false);

  const saving = saveFetcher.state !== "idle";
  const testing = testFetcher.state !== "idle";

  // React to save result
  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data) {
      const data = saveFetcher.data as any;
      setSaveResult({
        success: !!data.success,
        message: data.success ? "Credentials saved." : data.error || "Save failed.",
      });
    }
  }, [saveFetcher.state, saveFetcher.data]);

  // React to test result from the server
  useEffect(() => {
    if (testFetcher.state === "idle" && testFetcher.data) {
      const data = testFetcher.data as any;
      setTestResult({
        success: !!data.valid,
        message: data.valid ? "Connection successful!" : data.error || "Test failed",
      });
    }
  }, [testFetcher.state, testFetcher.data]);

  const handleSave = () => {
    setSaveResult(null);
    const formData = new FormData();
    formData.append("intent", "save_credentials");
    formData.append("supplier", supplier);
    formData.append("enabled", "true");
    formData.append("defaultShippingCode", shippingCode);
    fields.forEach((f) => formData.append(f.name, values[f.name] || ""));
    saveFetcher.submit(formData, { method: "POST" });
  };

  const handleTest = () => {
    setTestResult(null);
    const formData = new FormData();
    formData.append("intent", "test_credentials");
    formData.append("supplier", supplier);
    testFetcher.submit(formData, { method: "POST" });
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

            {saveResult && (
              <Banner tone={saveResult.success ? "success" : "critical"}>
                {saveResult.message}
              </Banner>
            )}

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
