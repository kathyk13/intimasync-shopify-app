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

// Shopify Auth Middleware for API routes
app.use('/api', async (req, res, next) => {
  const shop = req.headers['x-shopify-shop-domain'];
  const accessToken = req.headers['x-shopify-access-token'];
  
  if (shop) {
    try {
      const store = await prisma.store.findUnique({
        where: { shopDomain: shop }
      });
      
      if (store) {
        req.shop = shop;
        req.accessToken = store.accessToken;
        req.store = store;
        next();
      } else {
        res.status(401).json({ error: 'Store not found - please reinstall the app' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Authentication failed' });
    }
  } else {
    res.status(401).json({ error: 'Missing shop domain header' });
  }
});

// Shopify OAuth Routes
app.get('/', async (req, res) => {
  const { shop, host } = req.query;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  // Check if store is already installed
  const store = await prisma.store.findUnique({
    where: { shopDomain: shop }
  });

  if (store && store.accessToken) {
    // Store already installed, redirect to app
    return res.redirect(`/?shop=${shop}&host=${host}`);
  }

  // Start OAuth flow
  const authRoute = await shopify.auth.begin({
    shop,
    callbackPath: '/auth/callback',
    isOnline: false,
    rawRequest: req,
    rawResponse: res
  });

  res.redirect(authRoute);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const callback = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res
    });

    const { shop, accessToken } = callback.session;

    // Save or update store
    await prisma.store.upsert({
      where: { shopDomain: shop },
      update: { 
        accessToken,
        isActive: true 
      },
      create: {
        shopDomain: shop,
        accessToken,
        isActive: true
      }
    });

    // Redirect to app with embedded app token
    const host = req.query.host;
    res.redirect(`/?shop=${shop}&host=${host}&installed=true`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// App interface route (serves the React app)
app.get('/app', async (req, res) => {
  const { shop, host } = req.query;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  // Serve basic HTML that loads the React app
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IntimaSync</title>
        <script src="https://unpkg.com/@shopify/app-bridge@4"></script>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shopify/polaris@12/build/esm/styles.css">
    </head>
    <body>
        <div id="app">
            <div style="padding: 20px; font-family: Arial, sans-serif;">
                <h1>🎉 IntimaSync Successfully Installed!</h1>
                <p><strong>Welcome to IntimaSync - Your Multi-Supplier Inventory Management Solution</strong></p>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3>✅ Installation Complete</h3>
                    <p>Your app is now connected to <strong>${shop}</strong></p>
                </div>

                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3>🚀 Next Steps:</h3>
                    <ol>
                        <li><strong>Add Supplier Credentials:</strong> Configure your Nalpac, Honey's Place, and Eldorado accounts</li>
                        <li><strong>Sync Products:</strong> Import your supplier inventory</li>
                        <li><strong>Configure Settings:</strong> Set up order routing preferences</li>
                        <li><strong>Start Selling:</strong> Let IntimaSync handle the rest!</li>
                    </ol>
                </div>

                <div style="background: #f1f8e9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3>📊 Quick Stats Dashboard</h3>
                    <div id="stats">
                        <p>📦 Products: <span id="product-count">Loading...</span></p>
                        <p>🔄 Last Sync: <span id="last-sync">Never</span></p>
                        <p>📈 Status: <span style="color: green;">✅ Active</span></p>
                    </div>
                </div>

                <div style="margin: 20px 0;">
                    <button onclick="syncSuppliers()" style="background: #0066cc; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
                        🔄 Sync All Suppliers
                    </button>
                    <button onclick="openSettings()" style="background: #666; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer;">
                        ⚙️ Settings
                    </button>
                </div>

                <div id="messages" style="margin: 20px 0;"></div>
            </div>
        </div>

        <script>
            // Initialize Shopify App Bridge
            const app = window.ShopifyAppBridge.createApp({
                apiKey: '${process.env.SHOPIFY_API_KEY}',
                host: '${host}',
                forceRedirect: true
            });

            // Load initial data
            async function loadStats() {
                try {
                    const response = await fetch('/api/analytics/overview', {
                        headers: {
                            'X-Shopify-Shop-Domain': '${shop}',
                            'X-Shopify-Access-Token': 'temp'
                        }
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        document.getElementById('product-count').textContent = data.totalProducts || 0;
                    }
                } catch (error) {
                    console.log('Stats will load after supplier setup');
                }
            }

            // Sync suppliers
            async function syncSuppliers() {
                const button = event.target;
                button.disabled = true;
                button.textContent = '🔄 Syncing...';
                
                showMessage('Starting supplier sync...', 'info');
                
                try {
                    const response = await fetch('/api/suppliers/sync-all', {
                        method: 'POST',
                        headers: {
                            'X-Shopify-Shop-Domain': '${shop}',
                            'X-Shopify-Access-Token': 'temp'
                        }
                    });
                    
                    if (response.ok) {
                        showMessage('✅ Sync completed successfully!', 'success');
                        loadStats();
                    } else {
                        showMessage('⚠️ Please configure supplier credentials first', 'warning');
                    }
                } catch (error) {
                    showMessage('❌ Sync failed. Please check your supplier credentials.', 'error');
                } finally {
                    button.disabled = false;
                    button.textContent = '🔄 Sync All Suppliers';
                }
            }

            function openSettings() {
                showMessage('Settings panel coming soon! For now, use the API to configure credentials.', 'info');
            }

            function showMessage(text, type) {
                const messages = document.getElementById('messages');
                const div = document.createElement('div');
                div.style.padding = '10px';
                div.style.borderRadius = '4px';
                div.style.margin = '10px 0';
                
                switch(type) {
                    case 'success':
                        div.style.background = '#d4edda';
                        div.style.color = '#155724';
                        break;
                    case 'error':
                        div.style.background = '#f8d7da';
                        div.style.color = '#721c24';
                        break;
                    case 'warning':
                        div.style.background = '#fff3cd';
                        div.style.color = '#856404';
                        break;
                    default:
                        div.style.background = '#cce7ff';
                        div.style.color = '#004085';
                }
                
                div.textContent = text;
                messages.appendChild(div);
                
                setTimeout(() => div.remove(), 5000);
            }

            // Load stats on page load
            loadStats();
        </script>
    </body>
    </html>
  `);
});

// API Routes
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
