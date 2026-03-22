/**
 * IntimaSync - Billing Page
 * Shopify App Billing - plan selection and subscription management
 */

import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Badge,
  Button,
  InlineStack,
  Divider,
  List,
  Banner,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    interval: "EVERY_30_DAYS",
    suppliers: 1,
    trialDays: 14,
    features: [
      "Connect 1 supplier",
      "Full catalog sync",
      "Automated order routing",
      "Daily inventory updates",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 59,
    interval: "EVERY_30_DAYS",
    suppliers: 3,
    trialDays: 14,
    features: [
      "Connect up to 3 suppliers",
      "Full catalog sync",
      "Automated order routing",
      "Daily inventory updates",
      "Custom sync schedule",
      "Priority email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 99,
    interval: "EVERY_30_DAYS",
    suppliers: 99,
    trialDays: 14,
    features: [
      "Unlimited suppliers",
      "Full catalog sync",
      "Automated order routing",
      "Hourly inventory updates",
      "Custom sync schedule",
      "Priority support + onboarding call",
      "Early access to new suppliers",
    ],
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  let currentPlan = null;
  try {
    const { hasActivePayment, appSubscriptions } = await billing.check({
      plans: PLANS.map((p) => p.name),
      isTest: true,
    });
    if (hasActivePayment && appSubscriptions.length > 0) {
      currentPlan = appSubscriptions[0].name;
    }
  } catch (e) {
    // No active subscription
  }

  return json({ currentPlan, shop: { domain: session.shop } });
}

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const planId = String(formData.get("planId"));

  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) return json({ error: "Invalid plan" }, { status: 400 });

  await billing.request({
    plan: plan.name,
    isTest: true,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?success=true`,
  });

  return null;
}

export default function BillingPage() {
  const { currentPlan } = useLoaderData<typeof loader>();
  const url = new URL(window?.location?.href || "https://x.com");
  const success = url.searchParams.get("success");

  return (
    <Page
      title="Billing"
      subtitle="Choose the plan that fits your store"
    >
      <Layout>
        {success && (
          <Layout.Section>
            <Banner tone="success" title="Subscription activated!">
              You now have full access to IntimaSync. Start by importing products
              from your connected suppliers.
            </Banner>
          </Layout.Section>
        )}

        {!currentPlan && (
          <Layout.Section>
            <Banner tone="info" title="14-day free trial included">
              All plans include a 14-day free trial. You won't be charged until
              the trial ends. Cancel anytime.
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack gap="400" wrap align="start">
            {PLANS.map((plan) => {
              const isCurrent = currentPlan === plan.name;
              return (
                <div key={plan.id} style={{ flex: "1", minWidth: "240px", maxWidth: "320px" }}>
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">{plan.name}</Text>
                        {isCurrent && <Badge tone="success">Current Plan</Badge>}
                      </InlineStack>

                      <BlockStack gap="100">
                        <Text as="p" variant="headingXl">
                          ${plan.price}
                          <Text as="span" variant="bodySm" tone="subdued">/month</Text>
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {plan.suppliers === 99
                            ? "Unlimited suppliers"
                            : `Up to ${plan.suppliers} supplier${plan.suppliers > 1 ? "s" : ""}`}
                        </Text>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="200">
                        {plan.features.map((feature) => (
                          <InlineStack key={feature} gap="200" blockAlign="center">
                            <Text as="span" tone="success">â</Text>
                            <Text as="span" variant="bodySm">{feature}</Text>
                          </InlineStack>
                        ))}
                      </BlockStack>

                      <Form method="post">
                        <input type="hidden" name="planId" value={plan.id} />
                        <Button
                          variant={isCurrent ? "plain" : "primary"}
                          disabled={isCurrent}
                          submit
                          fullWidth
                        >
                          {isCurrent
                            ? "Current Plan"
                            : currentPlan
                            ? "Switch to " + plan.name
                            : `Start Free Trial`}
                        </Button>
                      </Form>
                    </BlockStack>
                  </Card>
                </div>
              );
            })}
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Billing FAQ</Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">When will I be charged?</Text>
                <Text as="p" tone="subdued">
                  After your 14-day free trial ends. Billing is handled securely
                  through Shopify - no credit card required upfront.
                </Text>
                <Text as="h3" variant="headingSm">Can I cancel anytime?</Text>
                <Text as="p" tone="subdued">
                  Yes. Cancel directly from your Shopify admin under Apps &gt;
                  IntimaSync. You'll retain access until the end of the billing
                  period.
                </Text>
                <Text as="h3" variant="headingSm">What happens if I exceed my supplier limit?</Text>
                <Text as="p" tone="subdued">
                  You'll be prompted to upgrade before adding an additional
                  supplier. Existing connections remain active.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
