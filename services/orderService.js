const { PrismaClient } = require('@prisma/client');
const supplierService = require('./supplierService');

const prisma = new PrismaClient();

class OrderService {
  
  async processOrder(shopifyOrder, store) {
    try {
      const order = await prisma.order.create({
        data: {
          shopifyOrderId: shopifyOrder.id.toString(),
          orderNumber: shopifyOrder.order_number,
          customerEmail: shopifyOrder.email,
          totalAmount: parseFloat(shopifyOrder.total_price),
          shippingAddress: shopifyOrder.shipping_address,
          storeId: store.id
        }
      });

      const lineItems = shopifyOrder.line_items;
      const routing = await this.calculateOptimalRouting(lineItems, store);

      for (const route of routing) {
        for (const item of route.items) {
          await prisma.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              supplierId: route.supplierId,
              quantity: item.quantity,
              unitCost: item.cost,
              totalCost: item.cost * item.quantity,
              supplierSku: item.supplierSku
            }
          });
        }
      }

      await this.submitOrdersToSuppliers(order.id, routing);
      return order;

    } catch (error) {
      console.error('Order processing error:', error);
      throw error;
    }
  }

  async calculateOptimalRouting(lineItems, store) {
    const productsBySupplier = new Map();
    
    for (const item of lineItems) {
      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { shopifyProductId: item.product_id.toString() },
            { internalSku: item.sku }
          ],
          storeId: store.id
        },
        include: {
          supplierProducts: {
            include: { supplier: true },
            where: { inventory: { gt: 0 } }
          }
        }
      });

      if (product && product.supplierProducts.length > 0) {
        let selectedSupplier = product.supplierProducts[0];
        
        if (product.isSupplierLocked && product.preferredSupplier) {
          selectedSupplier = product.supplierProducts.find(
            sp => sp.supplier.name === product.preferredSupplier
          ) || selectedSupplier;
        } else {
          selectedSupplier = product.supplierProducts.reduce((prev, current) => 
            prev.cost < current.cost ? prev : current
          );
        }

        const supplierName = selectedSupplier.supplier.name;
        
        if (!productsBySupplier.has(supplierName)) {
          productsBySupplier.set(supplierName, {
            supplierId: selectedSupplier.supplierId,
            items: [],
            totalCost: 0,
            totalItems: 0
          });
        }

        const supplierData = productsBySupplier.get(supplierName);
        supplierData.items.push({
          productId: product.id,
          quantity: item.quantity,
          cost: selectedSupplier.cost,
          supplierSku: selectedSupplier.supplierSku
        });
        supplierData.totalCost += selectedSupplier.cost * item.quantity;
        supplierData.totalItems += item.quantity;
      }
    }

    return Array.from(productsBySupplier.values());
  }

  async submitOrdersToSuppliers(orderId, routing) {
    console.log('Submitting orders to suppliers for order:', orderId);
    // Implementation for each supplier's order submission
  }
}

module.exports = new OrderService();
