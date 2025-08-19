const axios = require('axios');
const xml2js = require('xml2js');
const csv = require('csv-parser');
const { NodeSSH } = require('node-ssh');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class SupplierService {
  
  // Nalpac REST API Integration
  async syncNalpacProducts(store) {
    try {
      const response = await axios.get('https://api2.nalpac.com/products', {
        headers: {
          'Authorization': `Bearer ${store.nalpacPassword}`,
          'Content-Type': 'application/json'
        }
      });

      const products = response.data;
      
      for (const product of products) {
        await this.upsertProduct(store.id, 'nalpac', product);
      }

      await this.logSync(store.id, 'nalpac', 'products', 'success', products.length);
      
    } catch (error) {
      console.error('Nalpac sync error:', error);
      await this.logSync(store.id, 'nalpac', 'products', 'error', 0, error.message);
    }
  }

  // Honey's Place API Integration
  async syncHoneysPlaceProducts(store) {
    try {
      const feedUrl = `https://www.honeysplace.com/df/${store.honeysApiToken}/json`;
      const response = await axios.get(feedUrl);
      
      const products = response.data;
      
      for (const product of products) {
        await this.upsertProduct(store.id, 'honeysplace', product);
      }

      await this.logSync(store.id, 'honeysplace', 'products', 'success', products.length);
      
    } catch (error) {
      console.error('Honeys Place sync error:', error);
      await this.logSync(store.id, 'honeysplace', 'products', 'error', 0, error.message);
    }
  }

  // Eldorado SFTP Integration
  async syncEldoradoProducts(store) {
    const ssh = new NodeSSH();
    
    try {
      await ssh.connect({
        host: store.eldoradoHost || '52.27.75.88',
        username: store.eldoradoUsername,
        password: store.eldoradoPassword
      });

      const productFile = await ssh.getFile('./temp/eldorado_products.tsv', '/product_feed.tsv');
      const products = await this.parseTSVFile('./temp/eldorado_products.tsv');
      
      for (const product of products) {
        await this.upsertProduct(store.id, 'eldorado', product);
      }

      await this.logSync(store.id, 'eldorado', 'products', 'success', products.length);
      
    } catch (error) {
      console.error('Eldorado sync error:', error);
      await this.logSync(store.id, 'eldorado', 'products', 'error', 0, error.message);
    } finally {
      ssh.dispose();
    }
  }

  async upsertProduct(storeId, supplierName, productData) {
    const supplier = await prisma.supplier.findUnique({
      where: { name: supplierName }
    });

    if (!supplier) return;

    let product = await prisma.product.findFirst({
      where: {
        upc: productData.upc,
        storeId: storeId
      }
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          upc: productData.upc,
          title: productData.title || productData.name,
          description: productData.description,
          msrp: productData.msrp ? parseFloat(productData.msrp) : null,
          category: productData.category,
          brand: productData.brand,
          weight: productData.weight ? parseFloat(productData.weight) : null,
          dimensions: productData.dimensions,
          ingredients: productData.ingredients,
          storeId: storeId
        }
      });
    }

    await prisma.supplierProduct.upsert({
      where: {
        productId_supplierId: {
          productId: product.id,
          supplierId: supplier.id
        }
      },
      update: {
        cost: parseFloat(productData.cost || productData.price),
        inventory: parseInt(productData.inventory || 0),
        lastSyncAt: new Date()
      },
      create: {
        productId: product.id,
        supplierId: supplier.id,
        supplierSku: productData.sku,
        cost: parseFloat(productData.cost || productData.price),
        inventory: parseInt(productData.inventory || 0),
        lastSyncAt: new Date()
      }
    });

    return product;
  }

  async logSync(storeId, supplierId, syncType, status, recordsProcessed = 0, message = null) {
    await prisma.syncLog.create({
      data: {
        storeId,
        supplierId,
        syncType,
        status,
        message,
        recordsProcessed
      }
    });
  }

  async parseTSVFile(filePath) {
    return [];
  }
}

module.exports = new SupplierService();
