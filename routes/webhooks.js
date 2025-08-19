const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const orderService = require('../services/orderService');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verify Shopify webhook
const verifyWebhook = (req, res, next) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  if (hash !== hmac) {
    return res.status(401).send('Unauthorized');
  }
  next();
};

// Order created webhook
router.post('/orders/create', verifyWebhook, async (req, res) => {
  try {
    const shopifyOrder = req.body;
    const shopDomain = req.get('X-Shopify-Shop-Domain');

    const store = await prisma.store.findUnique({
      where: { shopDomain }
    });

    if (store) {
      await orderService.processOrder(shopifyOrder, store);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Order webhook error:', error);
    res.status(500).send('Error processing order');
  }
});

// App uninstalled webhook
router.post('/app/uninstalled', verifyWebhook, async (req, res) => {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    
    await prisma.store.update({
      where: { shopDomain },
      data: { isActive: false }
    });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Uninstall webhook error:', error);
    res.status(500).send('Error');
  }
});

module.exports = router;
