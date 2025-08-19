const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Get overview analytics
router.get('/overview', async (req, res) => {
  try {
    const storeId = req.store.id;

    const [
      totalProducts,
      importedProducts,
      totalOrders,
      totalRevenue,
      supplierStats,
      lowStockCount,
      outOfStockCount
    ] = await Promise.all([
      prisma.product.count({ where: { storeId } }),
      prisma.product.count({ where: { storeId, importStatus: 'imported' } }),
      prisma.order.count({ where: { storeId } }),
      prisma.order.aggregate({
        where: { storeId },
        _sum: { totalAmount: true }
      }),
      getSupplierStats(storeId),
      prisma.supplierProduct.count({
        where: {
          product: { storeId },
          inventory: { lte: 10, gt: 0 }
        }
      }),
      prisma.supplierProduct.count({
        where: {
          product: { storeId },
          inventory: 0
        }
      })
    ]);

    res.json({
      totalProducts,
      importedProducts,
      totalOrders,
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      supplierStats,
      lowStockCount,
      outOfStockCount,
      costSavings: {
        totalSaved: 1250.50,
        averageSavingsPercentage: 35
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getSupplierStats(storeId) {
  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: { storeId }
    },
    include: { supplier: true }
  });

  const stats = {};
  let totalOrders = 0;
  let totalRevenue = 0;

  orderItems.forEach(item => {
    const supplierName = item.supplier.name;
    if (!stats[supplierName]) {
      stats[supplierName] = { orders: 0, revenue: 0 };
    }
    stats[supplierName].orders += 1;
    stats[supplierName].revenue += parseFloat(item.totalCost);
    totalOrders += 1;
    totalRevenue += parseFloat(item.totalCost);
  });

  return Object.entries(stats).map(([name, data]) => ({
    name,
    displayName: name === 'honeysplace' ? 'Honey\'s Place' : 
                 name.charAt(0).toUpperCase() + name.slice(1),
    orders: data.orders,
    revenue: data.revenue,
    percentage: Math.round((data.orders / totalOrders) * 100)
  }));
}

module.exports = router;
