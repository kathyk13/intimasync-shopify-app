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
                showSettingsModal();
            }

            function showSettingsModal() {
                const modal = document.createElement('div');
                modal.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(0,0,0,0.5); z-index: 1000; display: flex; 
                    align-items: center; justify-content: center;
                `;
                
                modal.innerHTML = \`
                    <div style="background: white; padding: 30px; border-radius: 8px; width: 90%; max-width: 600px; max-height: 80%; overflow-y: auto;">
                        <h2>⚙️ Supplier Settings</h2>
                        <p>Configure your supplier API credentials to enable inventory sync.</p>
                        
                        <form id="settings-form">
                            <div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
                                <h3>🔵 Nalpac Configuration</h3>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>Username:</strong></label>
                                    <input type="text" id="nalpac-username" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your Nalpac username">
                                </div>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>Password:</strong></label>
                                    <input type="password" id="nalpac-password" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your Nalpac password">
                                </div>
                                <button type="button" onclick="testConnection('nalpac')" style="background: #0066cc; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;">
                                    Test Nalpac Connection
                                </button>
                                <span id="nalpac-status" style="margin-left: 10px;"></span>
                            </div>

                            <div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
                                <h3>🍯 Honey's Place Configuration</h3>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>Username:</strong></label>
                                    <input type="text" id="honeys-username" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your Honey's Place username">
                                </div>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>API Token:</strong></label>
                                    <input type="password" id="honeys-token" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your API token from Honey's Place">
                                </div>
                                <button type="button" onclick="testConnection('honeys')" style="background: #d32f2f; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;">
                                    Test Honey's Connection
                                </button>
                                <span id="honeys-status" style="margin-left: 10px;"></span>
                            </div>

                            <div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 4px;">
                                <h3>🏰 Eldorado Configuration</h3>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>SFTP Host:</strong></label>
                                    <input type="text" id="eldorado-host" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" value="52.27.75.88" placeholder="SFTP host (default: 52.27.75.88)">
                                </div>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>Username:</strong></label>
                                    <input type="text" id="eldorado-username" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your Eldorado username">
                                </div>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>Password:</strong></label>
                                    <input type="password" id="eldorado-password" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your Eldorado password">
                                </div>
                                <div style="margin: 10px 0;">
                                    <label style="display: block; margin-bottom: 5px;"><strong>Account Number:</strong></label>
                                    <input type="text" id="eldorado-account" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Your Eldorado account number">
                                </div>
                                <button type="button" onclick="testConnection('eldorado')" style="background: #388e3c; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;">
                                    Test Eldorado Connection
                                </button>
                                <span id="eldorado-status" style="margin-left: 10px;"></span>
                            </div>

                            <div style="margin: 30px 0; padding: 15px; background: #f8f9fa; border-radius: 4px;">
                                <h3>🔄 Sync Settings</h3>
                                <div style="margin: 10px 0;">
                                    <label style="display: inline-block; width: 200px;"><strong>Auto Sync Enabled:</strong></label>
                                    <input type="checkbox" id="auto-sync" checked> <span style="color: #666;">Automatically sync inventory daily</span>
                                </div>
                                <div style="margin: 10px 0;">
                                    <label style="display: inline-block; width: 200px;"><strong>Max Suppliers per Order:</strong></label>
                                    <select id="max-suppliers" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
                                        <option value="1">1 supplier (minimize costs)</option>
                                        <option value="2" selected>2 suppliers (balance cost/speed)</option>
                                        <option value="3">3 suppliers (maximize availability)</option>
                                    </select>
                                </div>
                            </div>

                            <div style="text-align: center; margin-top: 30px;">
                                <button type="button" onclick="saveSettings()" style="background: #0066cc; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; font-size: 16px;">
                                    💾 Save All Settings
                                </button>
                                <button type="button" onclick="closeSettings()" style="background: #666; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                \`;
                
                document.body.appendChild(modal);
                window.settingsModal = modal;
                
                // Load existing settings
                loadCurrentSettings();
            }

            async function testConnection(supplier) {
                const statusSpan = document.getElementById(supplier + '-status');
                statusSpan.innerHTML = '🔄 Testing...';
                
                let credentials = {};
                
                if (supplier === 'nalpac') {
                    credentials = {
                        username: document.getElementById('nalpac-username').value,
                        password: document.getElementById('nalpac-password').value
                    };
                } else if (supplier === 'honeys') {
                    credentials = {
                        username: document.getElementById('honeys-username').value,
                        token: document.getElementById('honeys-token').value
                    };
                } else if (supplier === 'eldorado') {
                    credentials = {
                        host: document.getElementById('eldorado-host').value,
                        username: document.getElementById('eldorado-username').value,
                        password: document.getElementById('eldorado-password').value,
                        account: document.getElementById('eldorado-account').value
                    };
                }

                try {
                    const response = await fetch(\`/api/suppliers/\${supplier}/test\`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Shop-Domain': '${shop}',
                            'X-Shopify-Access-Token': 'temp'
                        },
                        body: JSON.stringify(credentials)
                    });

                    if (response.ok) {
                        statusSpan.innerHTML = '✅ Connected';
                        statusSpan.style.color = 'green';
                    } else {
                        statusSpan.innerHTML = '❌ Failed';
                        statusSpan.style.color = 'red';
                    }
                } catch (error) {
                    statusSpan.innerHTML = '❌ Error';
                    statusSpan.style.color = 'red';
                }
            }

            async function saveSettings() {
                const settings = {
                    nalpac: {
                        username: document.getElementById('nalpac-username').value,
                        password: document.getElementById('nalpac-password').value
                    },
                    honeys: {
                        username: document.getElementById('honeys-username').value,
                        token: document.getElementById('honeys-token').value
                    },
                    eldorado: {
                        host: document.getElementById('eldorado-host').value,
                        username: document.getElementById('eldorado-username').value,
                        password: document.getElementById('eldorado-password').value,
                        account: document.getElementById('eldorado-account').value
                    },
                    sync: {
                        autoSync: document.getElementById('auto-sync').checked,
                        maxSuppliers: parseInt(document.getElementById('max-suppliers').value)
                    }
                };

                try {
                    const response = await fetch('/api/settings', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Shopify-Shop-Domain': '${shop}',
                            'X-Shopify-Access-Token': 'temp'
                        },
                        body: JSON.stringify(settings)
                    });

                    if (response.ok) {
                        showMessage('✅ Settings saved successfully!', 'success');
                        closeSettings();
                    } else {
                        showMessage('❌ Failed to save settings', 'error');
                    }
                } catch (error) {
                    showMessage('❌ Error saving settings', 'error');
                }
            }

            function closeSettings() {
                if (window.settingsModal) {
                    document.body.removeChild(window.settingsModal);
                    window.settingsModal = null;
                }
            }

            async function loadCurrentSettings() {
                try {
                    const response = await fetch('/api/settings', {
                        headers: {
                            'X-Shopify-Shop-Domain': '${shop}',
                            'X-Shopify-Access-Token': 'temp'
                        }
                    });

                    if (response.ok) {
                        const settings = await response.json();
                        
                        // Load Nalpac settings
                        if (settings.nalpac) {
                            document.getElementById('nalpac-username').value = settings.nalpac.username || '';
                        }
                        
                        // Load Honey's settings
                        if (settings.honeys) {
                            document.getElementById('honeys-username').value = settings.honeys.username || '';
                        }
                        
                        // Load Eldorado settings
                        if (settings.eldorado) {
                            document.getElementById('eldorado-host').value = settings.eldorado.host || '52.27.75.88';
                            document.getElementById('eldorado-username').value = settings.eldorado.username || '';
                            document.getElementById('eldorado-account').value = settings.eldorado.account || '';
                        }
                        
                        // Load sync settings
                        if (settings.sync) {
                            document.getElementById('auto-sync').checked = settings.sync.autoSync !== false;
                            document.getElementById('max-suppliers').value = settings.sync.maxSuppliers || 2;
                        }
                    }
                } catch (error) {
                    console.log('Could not load existing settings');
                }
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

// Settings API endpoint
app.get('/api/settings', async (req, res) => {
  try {
    const store = await prisma.store.findUnique({
      where: { id: req.store.id },
      select: {
        nalpacUsername: true,
        honeysUsername: true,
        eldoradoHost: true,
        eldoradoUsername: true,
        eldoradoAccount: true,
        autoSync: true,
        maxSuppliers: true
      }
    });

    res.json({
      nalpac: {
        username: store.nalpacUsername
      },
      honeys: {
        username: store.honeysUsername
      },
      eldorado: {
        host: store.eldoradoHost,
        username: store.eldoradoUsername,
        account: store.eldoradoAccount
      },
      sync: {
        autoSync: store.autoSync,
        maxSuppliers: store.maxSuppliers
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { nalpac, honeys, eldorado, sync } = req.body;

    await prisma.store.update({
      where: { id: req.store.id },
      data: {
        // Nalpac credentials
        nalpacUsername: nalpac?.username || null,
        nalpacPassword: nalpac?.password || null,
        
        // Honey's Place credentials
        honeysUsername: honeys?.username || null,
        honeysApiToken: honeys?.token || null,
        
        // Eldorado credentials
        eldoradoHost: eldorado?.host || null,
        eldoradoUsername: eldorado?.username || null,
        eldoradoPassword: eldorado?.password || null,
        eldoradoAccount: eldorado?.account || null,
        
        // Sync settings
        autoSync: sync?.autoSync !== false,
        maxSuppliers: sync?.maxSuppliers || 2
      }
    });

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test supplier connection endpoints
app.post('/api/suppliers/:supplier/test', async (req, res) => {
  try {
    const { supplier } = req.params;
    const credentials = req.body;

    // Simple connection test (you can enhance this with actual API calls)
    let isValid = false;
    
    if (supplier === 'nalpac') {
      isValid = credentials.username && credentials.password;
    } else if (supplier === 'honeys') {
      isValid = credentials.username && credentials.token;
    } else if (supplier === 'eldorado') {
      isValid = credentials.username && credentials.password && credentials.account;
    }

    if (isValid) {
      res.json({ status: 'success', message: 'Connection test passed' });
    } else {
      res.status(400).json({ status: 'error', message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
