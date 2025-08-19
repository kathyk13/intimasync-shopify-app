const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Get products with supplier data
router.get('/', async (req, res) => {
  try {
    const { search, category, supplier, page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      storeId: req.store.id,
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { upc: { contains: search } }
        ]
      }),
      ...(category && { category: category }),
      ...(supplier && {
        supplierProducts: {
          some: {
            supplier: { name: supplier }
          }
        }
      })
    };

    const products = await prisma.product.findMany({
      where,
      include: {
        supplierProducts: {
          include: { supplier: true }
        },
        images: true
      },
      skip: parseInt(skip),
      take: parseInt(limit),
      orderBy: { title: 'asc' }
    });

    res.json({ products });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import product to Shopify
router.post('/:id/import', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        supplierProducts: { include: { supplier: true } },
        images: true
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Get cheapest supplier
    const cheapestSupplier = product.supplierProducts.reduce((prev, current) => 
      prev.cost < current.cost ? prev : current
    );

    // Update product record
    await prisma.product.update({
      where: { id: product.id },
      data: {
        importStatus: 'imported',
        internalSku: req.body.internalSku || cheapestSupplier.supplierSku,
        isFavorite: req.body.addToFavorites || false
      }
    });

    res.json({ message: 'Product imported successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle favorite
router.patch('/:id/favorite', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });

    await prisma.product.update({
      where: { id: req.params.id },
      data: { isFavorite: !product.isFavorite }
    });

    res.json({ message: 'Favorite status updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export products CSV
router.get('/export', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { storeId: req.store.id },
      include: {
        supplierProducts: { include: { supplier: true } }
      }
    });

    // Generate CSV
    const csvHeader = 'Title,UPC,Category,MSRP,Nalpac Cost,Nalpac Inventory,Honeys Cost,Honeys Inventory,Eldorado Cost,Eldorado Inventory\n';
    const csvRows = products.map(product => {
      const nalpac = product.supplierProducts.find(sp => sp.supplier.name === 'nalpac');
      const honeys = product.supplierProducts.find(sp => sp.supplier.name === 'honeysplace');
      const eldorado = product.supplierProducts.find(sp => sp.supplier.name === 'eldorado');

      return [
        product.title,
        product.upc || '',
        product.category || '',
        product.msrp || '',
        nalpac?.cost || '',
        nalpac?.inventory || '',
        honeys?.cost || '',
        honeys?.inventory || '',
        eldorado?.cost || '',
        eldorado?.inventory || ''
      ].join(',');
    });

    const csv = csvHeader + csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=intimasync-products.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
