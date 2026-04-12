/**
 * IntimaSync - Support Page
 * Documentation, FAQ, and contact
 */

import { Page, Layout, Card, BlockStack, Text, Button, Divider, InlineStack, Badge } from "@shopify/polaris";
import { EmailIcon, QuestionCircleIcon } from "@shopify/polaris-icons";

export default function SupportPage() {
  return (
    <Page title="Support" subtitle="Documentation, guides, and help">
      <Layout>

        {/* Getting Started */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Getting Started</Text>
              <Divider />
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">1. Connect your suppliers</Text>
                  <Text as="p" tone="subdued">
                    Go to Settings and enter your API credentials for each supplier
                    (Eldorado, Honey's Place, Nalpac). Use the "Test Connection"
                    button to confirm they work. A catalog sync will run automatically
                    once a connection is verified.
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">2. Browse and import products</Text>
                  <Text as="p" tone="subdued">
                    Open the Products page to see every SKU available across your
                    connected suppliers, with live pricing and stock levels. Select
                    products and click "Import to Shopify" to add them as drafts.
                    You'll be asked to choose a description, select images, and
                    set a SKU before import.
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">3. Order routing is automatic</Text>
                  <Text as="p" tone="subdued">
                    When a customer places an order in your Shopify store,
                    IntimaSync checks all connected suppliers and routes to the
                    one with the lowest cost and available stock. You can lock a
                    product to a specific supplier if you prefer. Track all routed
                    orders in the Orders tab.
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="h3" variant="headingSm">4. Keep inventory in sync</Text>
                  <Text as="p" tone="subdued">
                    IntimaSync syncs supplier inventory once daily at 2 AM. Growth
                    and Pro plan users can customize this time in Settings. You can
                    also trigger a manual sync at any time from the Sync page.
                  </Text>
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* How Fulfillment Works */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">How Fulfillment Routing Works</Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="p">
                  IntimaSync routes orders by matching the Shopify product ID to a
                  supplier record in our database - not by SKU. This means you can
                  skip the SKU field during import without breaking fulfillment.
                </Text>
                <Text as="p">
                  When an order comes in, IntimaSync evaluates each supplier that
                  carries the item and selects the one with the lowest cost
                  and in-stock quantity. If you've manually locked a product to a
                  specific supplier (using the Fulfillment Source dropdown in
                  Products), that supplier is always used regardless of price.
                </Text>
                <Text as="p">
                  If two suppliers have the same price, IntimaSync uses the
                  fulfillment priority you set in Settings (drag to reorder
                  suppliers). You don't need to create Shopify Locations for each
                  supplier - IntimaSync manages routing independently.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* FAQ */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Frequently Asked Questions</Text>
              <Divider />
              <BlockStack gap="400">
                {[
                  {
                    q: "Does IntimaSync interfere with other fulfillment locations?",
                    a: "No. IntimaSync submits orders directly to suppliers via their APIs and marks them fulfilled in Shopify. If a product is not matched to any IntimaSync supplier, the order will remain unfulfilled in Shopify so your other workflow can handle it.",
                  },
                  {
                    q: "What happens if a sync fails?",
                    a: "Partial results are saved. The Sync page shows the last known status for each supplier, including any error message. You can re-trigger a sync manually at any time.",
                  },
                  {
                    q: "Can I use IntimaSync if I already have products in Shopify?",
                    a: "Yes. Use the Linked Products tab to see your existing Shopify products and whether they match any supplier records. You can link them from that view without re-importing.",
                  },
                  {
                    q: "Is the Entrenue catalog available through Nalpac?",
                    a: "Yes - Entrenue was acquired by Nalpac's parent company in 2022 and its catalog is now accessible through your existing Nalpac credentials. No separate setup is needed.",
                  },
                  {
                    q: "How do I add Sex Toy Distributing / XR Direct?",
                    a: "Go to Settings and enter your STD and XR Direct credentials separately. STD provides the catalog, and XR Direct handles order submission. Both accounts are required.",
                  },
                ].map(({ q, a }) => (
                  <BlockStack key={q} gap="100">
                    <Text as="h3" variant="headingSm">{q}</Text>
                    <Text as="p" tone="subdued">{a}</Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Contact */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Contact Us</Text>
              <Divider />
              <Text as="p" tone="subdued">
                Need help not covered here? We typically respond within one business day.
              </Text>
              <InlineStack gap="300">
                <Button
                  icon={EmailIcon}
                  url="mailto:support@intimasync.com"
                  target="_blank"
                >
                  Email Support
                </Button>
                <Button
                  url="https://docs.intimasync.com"
                  target="_blank"
                  variant="plain"
                >
                  Full Documentation
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
