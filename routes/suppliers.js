const express = require('express');
const router = express.Router();
const supplierService = require('../services/supplierService');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Get all suppliers
router.get('/', async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        supplierProducts: {
          include: { product: true }
        }
      }
    });
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync all suppliers
router.post('/sync-all', async (req, res) => {
  try {
    const store = req.store;
    
    // Sync each supplier
    await Promise.allSettled([
      supplierService.syncNalpacProducts(store),
      supplierService.syncHoneysPlaceProducts(store),
      supplierService.syncEldoradoProducts(store)
    ]);

    res.json({ message: 'Sync initiated for all suppliers' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sync status
router.get('/sync-status', async (req, res) => {
  try {
    const syncLogs = await prisma.syncLog.findMany({
      where: { storeId: req.store.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const status = [
      { name: 'nalpac', displayName: 'Nalpac' },
      { name: 'honeysplace', displayName: 'Honey\'s Place' },
      { name: 'eldorado', displayName: 'Eldorado' }
    ].map(supplier => {
      const lastSync = syncLogs.find(log => log.supplierId === supplier.name);
      return {
        ...supplier,
        status: lastSync?.status || 'never',
        lastSync: lastSync?.createdAt,
        recordsProcessed: lastSync?.recordsProcessed || 0
      };
    });

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
