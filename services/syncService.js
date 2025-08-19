const { PrismaClient } = require('@prisma/client');
const supplierService = require('./supplierService');

const prisma = new PrismaClient();

class SyncService {
  async syncAllSuppliers() {
    console.log('Starting sync for all stores...');
    
    const stores = await prisma.store.findMany({
      where: { 
        isActive: true,
        autoSync: true
      }
    });

    for (const store of stores) {
      await this.syncStoreSuppliers(store);
    }
  }

  async syncStoreSuppliers(store) {
    try {
      console.log(`Syncing suppliers for store: ${store.shopDomain}`);

      const syncPromises = [];

      if (store.nalpacUsername && store.nalpacPassword) {
        syncPromises.push(supplierService.syncNalpacProducts(store));
      }

      if (store.honeysUsername && store.honeysApiToken) {
        syncPromises.push(supplierService.syncHoneysPlaceProducts(store));
      }

      if (store.eldoradoUsername && store.eldoradoPassword) {
        syncPromises.push(supplierService.syncEldoradoProducts(store));
      }

      await Promise.allSettled(syncPromises);
      
      console.log(`Sync completed for store: ${store.shopDomain}`);
    } catch (error) {
      console.error(`Sync error for store ${store.shopDomain}:`, error);
    }
  }
}

module.exports = new SyncService();
