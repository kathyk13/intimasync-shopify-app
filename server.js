const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cron = require('node-cron');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const { restResources } = require('@shopify/shopify-api/rest/admin/2023-07');
const { ApiVersion } = require('@shopify/shopify-api');

// Import the Node.js adapter - THIS IS THE FIX!
require('@shopify/shopify-api/adapters/node');

require('dotenv').config();


// Validate required environment variables
const requiredEnvVars = ['SHOPIFY_API_KEY', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars);
  process.exit(1);
}

// Check for Shopify API secret (multiple possible names)
if (!process.env.SHOPIFY_API_SECRET_KEY && !process.env.SHOPIFY_API_SECRET) {
  console.error('Missing SHOPIFY_API_SECRET_KEY or SHOPIFY_API_SECRET');
  process.exit(1);
}

console.log('✅ Environment variables validated');
console.log('📝 Shopify API Key:', process.env.SHOPIFY_API_KEY ? 'Set' : 'Missing');
console.log('📝 Shopify API Secret:', (process.env.SHOPIFY_API_SECRET_KEY || process.env.SHOPIFY_API_SECRET) ? 'Set' : 'Missing');
console.log('📝 Database:', process.env.DATABASE_URL ? 'Set' : 'Missing');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const supplierRoutes = require('./routes/suppliers');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const analyticsRoutes = require('./routes/analytics');
const webhookRoutes = require('./routes/webhooks');
const billingRoutes = require('./routes/billing');

const { syncAllSuppliers } = require('./services/syncService');
const { processOrderRouting } = require('./services/orderService');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET_KEY || process.env.SHOPIFY_API_SECRET,
  scopes: ['read_products', 'write_products', 'read_orders', 'write_orders', 'read_inventory', 'write_inventory'],
  hostName: process.env.HOST_NAME || 'intimasync-backend.onrender.com',
  apiVersion: ApiVersion.July23,
  isEmbeddedApp: true,
  restResources,
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Shopify Auth Middleware
app.use('/api', async (req, res, next) => {
  const shop = req.headers['x-shopify-shop-domain'];
  const accessToken = req.headers['x-shopify-access-token'];
  
  if (shop && accessToken) {
    try {
      const store = await prisma.store.findUnique({
        where: { shopDomain: shop }
      });
      
      if (store && store.accessToken === accessToken) {
        req.shop = shop;
        req.accessToken = accessToken;
        req.store = store;
        next();
      } else {
        res.status(401).json({ error: 'Invalid store credentials' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Authentication failed' });
    }
  } else {
    res.status(401).json({ error: 'Missing authentication headers' });
  }
});

// Routes
app.use('/api/suppliers', supplierRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/webhooks', webhookRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Automated Sync Jobs
cron.schedule('0 */6 * * *', async () => {
  console.log('Running automated supplier sync...');
  await syncAllSuppliers();
});

cron.schedule('*/15 * * * *', async () => {
  console.log('Processing pending orders...');
  await processOrderRouting();
});

// Error Handler
app.use((error, req, res, next) => {
  console.error('Application Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`IntimaSync server running on port ${PORT}`);
});

module.exports = app;
