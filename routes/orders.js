const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const orderService = require('../services/orderService');

const prisma = new PrismaClient();

// Get recent orders
router.get('/recent', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { storeId: req.store.id },
      include: {
        orderItems: {
          include: { supplier: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const ordersWithSupplierCount = orders.map(order => ({
      ...order,
      supplierCount: new Set(order.orderItems.map(item => item.supplierId)).size
    }));

    res.json(ordersWithSupplierCount);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get order details
router.get('/:id', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        orderItems: {
          include: { product: true, supplier: true }
        },
        fulfillments: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
