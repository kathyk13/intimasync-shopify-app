const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Get subscription plans
router.get('/plans', (req, res) => {
  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: 29,
      features: ['1 supplier', '500 products', 'Daily sync'],
      stripePriceId: 'price_starter_monthly'
    },
    {
      id: 'professional',
      name: 'Professional',
      price: 79,
      features: ['3 suppliers', '2,000 products', 'Hourly sync'],
      stripePriceId: 'price_professional_monthly'
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 149,
      features: ['Unlimited suppliers', 'Unlimited products', 'Real-time sync'],
      stripePriceId: 'price_enterprise_monthly'
    }
  ];

  res.json(plans);
});

// Create subscription
router.post('/subscribe', async (req, res) => {
  try {
    const { planId } = req.body;
    const store = req.store;

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: store.contactEmail,
      metadata: {
        shopDomain: store.shopDomain,
        storeId: store.id
      }
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: getPriceIdForPlan(planId) }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent']
    });

    // Update store with subscription info
    await prisma.store.update({
      where: { id: store.id },
      data: {
        planType: planId,
        billingStatus: 'active',
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id
      }
    });

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getPriceIdForPlan(planId) {
  const priceIds = {
    starter: 'price_starter_monthly',
    professional: 'price_professional_monthly',
    enterprise: 'price_enterprise_monthly'
  };
  return priceIds[planId];
}

module.exports = router;
