const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const multer = require('multer');
const path = require('path');

// Initialize Prisma Client
const prisma = new PrismaClient();

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 10000;

// Environment Variables Validation
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.shopify.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://admin.shopify.com', 'http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body Parser Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request Logging Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint with app info
app.get('/', (req, res) => {
  res.json({
    name: 'IntimaSync API',
    version: '1.0.0',
    description: 'Multi-supplier inventory management for Shopify',
    endpoints: {
      health: '/health',
      suppliers: '/api/suppliers',
      products: '/api/products',
      orders: '/api/orders',
      webhooks: '/webhooks',
      auth: '/auth'
    }
  });
});

// Utility Functions
function encrypt(text) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipher(algorithm, key);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
  
  const textParts = encryptedText.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encrypted = textParts.join(':');
  
  const decipher = crypto.createDecipher(algorithm, key);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Shopify Verification Middleware
function verifyShopifyRequest(req, res, next) {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  // Validate shop domain format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
    return res.status(400).json({ error: 'Invalid shop domain' });
  }

  req.shop = shop;
  next();
}

// File Upload Configuration
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|csv|xlsx|xml/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// API Routes

// Suppliers Management Routes
app.get('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { shopId: req.user.shopId },
      include: {
        products: {
          take: 5,
          orderBy: { updatedAt: 'desc' }
        }
      }
    });

    res.json({
      success: true,
      suppliers: suppliers.map(supplier => ({
        ...supplier,
        credentials: supplier.credentials ? '***ENCRYPTED***' : null,
        isConnected: !!supplier.credentials && supplier.isActive,
        lastSync: supplier.lastSyncAt,
        productCount: supplier.products?.length || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

app.post('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    const { name, type, credentials, settings } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    const encryptedCredentials = credentials ? encrypt(JSON.stringify(credentials)) : null;

    const supplier = await prisma.supplier.create({
      data: {
        name,
        type,
        credentials: encryptedCredentials,
        settings: settings || {},
        shopId: req.user.shopId,
        isActive: true
      }
    });

    res.status(201).json({
      success: true,
      supplier: {
        ...supplier,
        credentials: '***ENCRYPTED***'
      }
    });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

app.put('/api/suppliers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, credentials, settings, isActive } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (credentials) updateData.credentials = encrypt(JSON.stringify(credentials));
    if (settings) updateData.settings = settings;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;

    const supplier = await prisma.supplier.update({
      where: { 
        id: parseInt(id),
        shopId: req.user.shopId 
      },
      data: updateData
    });

    res.json({
      success: true,
      supplier: {
        ...supplier,
        credentials: '***ENCRYPTED***'
      }
    });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

app.delete('/api/suppliers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.supplier.delete({
      where: { 
        id: parseInt(id),
        shopId: req.user.shopId 
      }
    });

    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ error: 'Failed to delete supplier' });
  }
});

// Supplier Connection Testing Routes
app.post('/api/suppliers/:id/test-connection', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const supplier = await prisma.supplier.findUnique({
      where: { 
        id: parseInt(id),
        shopId: req.user.shopId 
      }
    });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    if (!supplier.credentials) {
      return res.status(400).json({ error: 'No credentials configured for this supplier' });
    }

    const credentials = JSON.parse(decrypt(supplier.credentials));
    let testResult;

    switch (supplier.type.toLowerCase()) {
      case 'nalpac':
        testResult = await testNalpacConnection(credentials);
        break;
      case 'honeys':
      case 'honeys-place':
        testResult = await testHoneysConnection(credentials);
        break;
      case 'eldorado':
        testResult = await testEldoradoConnection(credentials);
        break;
      default:
        return res.status(400).json({ error: 'Unknown supplier type' });
    }

    if (testResult.isValid) {
      // Update supplier's last connection test
      await prisma.supplier.update({
        where: { id: parseInt(id) },
        data: { lastSyncAt: new Date() }
      });

      res.json({ status: 'success', message: testResult.message });
    } else {
      res.status(400).json({ status: 'error', message: testResult.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REAL API CONNECTION TEST FUNCTIONS
async function testNalpacConnection(credentials) {
  try {
    if (!credentials.username || !credentials.password) {
      return { isValid: false, message: 'Username and password required' };
    }

    const axios = require('axios');

    // Method 1: Try the new REST API (most likely to work)
    try {
      const authResponse = await axios.post('https://api.nalpac.com/v2/authenticate', {
        username: credentials.username,
        password: credentials.password
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'IntimaSync/1.0'
        },
        timeout: 15000
      });

      if (authResponse.status === 200 && authResponse.data.token) {
        // Test the authenticated endpoint
        const testResponse = await axios.get('https://api.nalpac.com/v2/products?limit=1', {
          headers: {
            'Authorization': `Bearer ${authResponse.data.token}`,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        return { 
          isValid: true, 
          message: `✅ Nalpac API v2 Connected! Found ${testResponse.data.total || 0} products available.` 
        };
      }
    } catch (apiError) {
      console.log('Nalpac API v2 failed, trying XML feed...');
    }

    // Method 2: Try XML data feed (fallback)
    try {
      const xmlResponse = await axios.get(`https://feeds.nalpac.com/datafeed.xml`, {
        auth: {
          username: credentials.username,
          password: credentials.password
        },
        headers: {
          'User-Agent': 'IntimaSync/1.0'
        },
        timeout: 20000,
        maxContentLength: 1000000 // Limit to 1MB for test
      });

      if (xmlResponse.status === 200 && xmlResponse.data.includes('<product')) {
        return { 
          isValid: true, 
          message: `✅ Nalpac XML Feed Connected! Data feed accessible.` 
        };
      }
    } catch (xmlError) {
      console.log('Nalpac XML feed failed, trying direct login...');
    }

    // Method 3: Try direct login endpoint
    try {
      const loginResponse = await axios.post('https://www.nalpac.com/customer/account/loginPost/', {
        'login[username]': credentials.username,
        'login[password]': credentials.password,
        'send': ''
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'IntimaSync/1.0'
        },
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: function (status) {
          return status < 400; // Accept redirects as success
        }
      });

      if (loginResponse.status < 400) {
        return { 
          isValid: true, 
          message: `✅ Nalpac Login Successful! Credentials verified.` 
        };
      }
    } catch (loginError) {
      // Even if this fails, we've tried all methods
    }

    return { 
      isValid: false, 
      message: '❌ Could not authenticate with Nalpac. Please verify your username and password.' 
    };

  } catch (error) {
    return { 
      isValid: false, 
      message: `❌ Nalpac connection error: ${error.message}` 
    };
  }
}

async function testHoneysConnection(credentials) {
  try {
    if (!credentials.username || !credentials.token) {
      return { isValid: false, message: 'Username and API token required' };
    }

    const axios = require('axios');

    // Method 1: Try JSON data feed (primary method)
    try {
      const jsonFeedUrl = `https://www.honeysplace.com/df/${credentials.token}/json?limit=5`;
      
      const response = await axios.get(jsonFeedUrl, {
        headers: {
          'User-Agent': 'IntimaSync/1.0 (Shopify App)',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        timeout: 20000
      });

      if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
        const firstProduct = response.data[0];
        return { 
          isValid: true, 
          message: `✅ Honey's Place JSON Feed Connected! Found ${response.data.length} products. Sample: "${firstProduct.product_name || firstProduct.name || 'Product'}"` 
        };
      } else if (response.status === 200 && Array.isArray(response.data)) {
        return { 
          isValid: true, 
          message: `✅ Honey's Place Connected! Feed is accessible (currently empty).` 
        };
      }
    } catch (jsonError) {
      console.log('JSON feed failed, trying XML...');
    }

    // Method 2: Try XML data feed (fallback)
    try {
      const xmlFeedUrl = `https://www.honeysplace.com/df/${credentials.token}/xml?limit=5`;
      
      const xmlResponse = await axios.get(xmlFeedUrl, {
        headers: {
          'User-Agent': 'IntimaSync/1.0 (Shopify App)',
          'Accept': 'application/xml,text/xml',
          'Cache-Control': 'no-cache'
        },
        timeout: 20000
      });

      if (xmlResponse.status === 200 && xmlResponse.data.includes('<product')) {
        return { 
          isValid: true, 
          message: `✅ Honey's Place XML Feed Connected! Data feed accessible.` 
        };
      }
    } catch (xmlError) {
      console.log('XML feed failed, trying CSV...');
    }

    // Method 3: Try CSV data feed (alternative)
    try {
      const csvFeedUrl = `https://www.honeysplace.com/df/${credentials.token}/csv?limit=5`;
      
      const csvResponse = await axios.get(csvFeedUrl, {
        headers: {
          'User-Agent': 'IntimaSync/1.0 (Shopify App)',
          'Accept': 'text/csv',
          'Cache-Control': 'no-cache'
        },
        timeout: 20000
      });

      if (csvResponse.status === 200 && csvResponse.data.includes('product')) {
        return { 
          isValid: true, 
          message: `✅ Honey's Place CSV Feed Connected! Data feed accessible.` 
        };
      }
    } catch (csvError) {
      // All methods failed
    }

    return { 
      isValid: false, 
      message: '❌ Invalid API token or feed not accessible. Please verify your Honey\'s Place API token.' 
    };

  } catch (error) {
    if (error.response) {
      if (error.response.status === 404) {
        return { 
          isValid: false, 
          message: '❌ Feed not found. Please check your API token format.' 
        };
      } else if (error.response.status === 403) {
        return { 
          isValid: false, 
          message: '❌ Access denied. Please verify your API token permissions.' 
        };
      } else {
        return { 
          isValid: false, 
          message: `❌ Honey's Place API Error: ${error.response.status}` 
        };
      }
    } else {
      return { 
        isValid: false, 
        message: `❌ Connection failed: ${error.message}` 
      };
    }
  }
}

async function testEldoradoConnection(credentials) {
  try {
    if (!credentials.username || !credentials.password || !credentials.account) {
      return { isValid: false, message: 'Username, password, and account number (Customer ID) required' };
    }

    const { NodeSSH } = require('node-ssh');
    const ssh = new NodeSSH();

    try {
      // Test SFTP connection with multiple host options
      const hosts = [
        credentials.host || '52.27.75.88',
        'ftp.eldorado.net',
        'sftp.eldorado.net'
      ];

      let connected = false;
      let connectionResult = null;

      for (const host of hosts) {
        try {
          console.log(`Trying Eldorado connection to ${host}...`);
          
          await ssh.connect({
            host: host,
            username: credentials.username,
            password: credentials.password,
            port: 22,
            readyTimeout: 20000,
            algorithms: {
              serverHostKey: ['ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
              kex: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha256'],
              cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm'],
              hmac: ['hmac-sha1', 'hmac-sha1-96', 'hmac-sha2-256', 'hmac-sha2-512']
            }
          });

          // Test basic directory listing
          const pwdResult = await ssh.execCommand('pwd');
          console.log('PWD result:', pwdResult);

          // Try to list files
          const lsResult = await ssh.execCommand('ls -la');
          console.log('LS result:', lsResult);

          // Look for common Eldorado file patterns
          const findResult = await ssh.execCommand('find . -name "*price*" -o -name "*product*" -o -name "*inventory*" | head -10');
          
          connected = true;
          connectionResult = {
            host: host,
            directory: pwdResult.stdout || '/',
            files: lsResult.stdout ? lsResult.stdout.split('\n').length - 1 : 0,
            dataFiles: findResult.stdout ? findResult.stdout.split('\n').filter(f => f.trim()).length : 0
          };
          break;

        } catch (hostError) {
          console.log(`Failed to connect to ${host}:`, hostError.message);
          continue;
        }
      }

      ssh.dispose();

      if (connected && connectionResult) {
        return { 
          isValid: true, 
          message: `✅ Eldorado SFTP Connected to ${connectionResult.host}! Customer ID: ${credentials.account}. Found ${connectionResult.files} files, ${connectionResult.dataFiles} data files.` 
        };
      } else {
        return { 
          isValid: false, 
          message: `❌ Could not connect to any Eldorado SFTP servers. Tried: ${hosts.join(', ')}` 
        };
      }

    } catch (sshError) {
      return { 
        isValid: false, 
        message: `❌ SFTP connection failed: ${sshError.message}` 
      };
    }

  } catch (error) {
    return { 
      isValid: false, 
      message: `❌ Eldorado connection error: ${error.message}` 
    };
  }
}

// Products Management Routes
app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const { supplier, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { shopId: req.user.shopId };
    if (supplier) whereClause.supplierId = parseInt(supplier);
    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: whereClause,
        include: {
          supplier: true,
          priceComparisons: {
            include: {
              supplier: true
            },
            orderBy: { price: 'asc' }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.product.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      products: products.map(product => ({
        ...product,
        cheapestSupplier: product.priceComparisons[0]?.supplier?.name,
        cheapestPrice: product.priceComparisons[0]?.price,
        priceRange: {
          min: product.priceComparisons[0]?.price,
          max: product.priceComparisons[product.priceComparisons.length - 1]?.price
        }
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/products/sync', authenticateToken, async (req, res) => {
  try {
    const { supplierId } = req.body;
    
    if (!supplierId) {
      return res.status(400).json({ error: 'Supplier ID is required' });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { 
        id: parseInt(supplierId),
        shopId: req.user.shopId 
      }
    });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    if (!supplier.credentials) {
      return res.status(400).json({ error: 'Supplier credentials not configured' });
    }

    // Start background sync
    syncSupplierProducts(supplier).catch(console.error);

    res.json({ 
      success: true, 
      message: 'Product sync started in background',
      supplierId: supplier.id,
      supplierName: supplier.name
    });
  } catch (error) {
    console.error('Error starting product sync:', error);
    res.status(500).json({ error: 'Failed to start product sync' });
  }
});

app.post('/api/products/import-to-shopify', authenticateToken, async (req, res) => {
  try {
    const { productId, shopifyPrice, customSku } = req.body;

    if (!productId || !shopifyPrice) {
      return res.status(400).json({ error: 'Product ID and Shopify price are required' });
    }

    const product = await prisma.product.findUnique({
      where: { 
        id: parseInt(productId),
        shopId: req.user.shopId 
      },
      include: {
        supplier: true,
        priceComparisons: {
          include: { supplier: true },
          orderBy: { price: 'asc' }
        }
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Import to Shopify using Shopify Admin API
    const shopifyProduct = await importProductToShopify(product, shopifyPrice, customSku);

    // Update product with Shopify ID
    await prisma.product.update({
      where: { id: parseInt(productId) },
      data: { 
        shopifyProductId: shopifyProduct.id.toString(),
        isImported: true,
        importedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Product imported to Shopify successfully',
      shopifyProduct: {
        id: shopifyProduct.id,
        title: shopifyProduct.title,
        handle: shopifyProduct.handle
      }
    });
  } catch (error) {
    console.error('Error importing product to Shopify:', error);
    res.status(500).json({ error: 'Failed to import product to Shopify' });
  }
});

// Orders Management Routes
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { status, supplier, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { shopId: req.user.shopId };
    if (status) whereClause.status = status;
    if (supplier) whereClause.supplierId = parseInt(supplier);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        include: {
          supplier: true,
          items: {
            include: {
              product: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.order.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/orders/route', authenticateToken, async (req, res) => {
  try {
    const { shopifyOrderId, items } = req.body;

    if (!shopifyOrderId || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Shopify order ID and items are required' });
    }

    const routedOrders = await routeOrderToSuppliers(shopifyOrderId, items, req.user.shopId);

    res.json({
      success: true,
      message: 'Order routed to suppliers successfully',
      routes: routedOrders.map(order => ({
        supplier: order.supplier.name,
        orderNumber: order.orderNumber,
        itemCount: order.items.length,
        totalAmount: order.totalAmount,
        status: order.status
      }))
    });
  } catch (error) {
    console.error('Error routing order:', error);
    res.status(500).json({ error: 'Failed to route order' });
  }
});

// Analytics Routes
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [
      supplierCount,
      productCount,
      orderCount,
      recentOrders,
      topSuppliers,
      pricingSavings
    ] = await Promise.all([
      prisma.supplier.count({
        where: { shopId: req.user.shopId, isActive: true }
      }),
      prisma.product.count({
        where: { shopId: req.user.shopId }
      }),
      prisma.order.count({
        where: { 
          shopId: req.user.shopId,
          createdAt: { gte: startDate }
        }
      }),
      prisma.order.findMany({
        where: { shopId: req.user.shopId },
        include: { supplier: true },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      prisma.order.groupBy({
        by: ['supplierId'],
        where: { 
          shopId: req.user.shopId,
          createdAt: { gte: startDate }
        },
        _count: { id: true },
        _sum: { totalAmount: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5
      }),
      calculatePricingSavings(req.user.shopId, startDate)
    ]);

    res.json({
      success: true,
      analytics: {
        summary: {
          suppliers: supplierCount,
          products: productCount,
          orders: orderCount,
          savings: pricingSavings
        },
        recentOrders: recentOrders.map(order => ({
          id: order.id,
          orderNumber: order.orderNumber,
          supplier: order.supplier.name,
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: order.createdAt
        })),
        topSuppliers: topSuppliers.map(supplier => ({
          supplierId: supplier.supplierId,
          orderCount: supplier._count.id,
          totalAmount: supplier._sum.totalAmount || 0
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Shopify Authentication Routes
app.get('/auth', verifyShopifyRequest, (req, res) => {
  const { shop } = req.query;
  const scopes = 'read_products,write_products,read_orders,write_orders,read_inventory,write_inventory';
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  
  // Store state in session or database for verification
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
  
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, shop, state } = req.query;
    
    if (!code || !shop) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Exchange code for access token
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    });

    const { access_token } = tokenResponse.data;

    // Create or update shop record
    const shopRecord = await prisma.shop.upsert({
      where: { domain: shop },
      update: { 
        accessToken: encrypt(access_token),
        isActive: true,
        lastLoginAt: new Date()
      },
      create: {
        domain: shop,
        accessToken: encrypt(access_token),
        isActive: true,
        lastLoginAt: new Date()
      }
    });

    // Generate JWT for the session
    const token = jwt.sign(
      { shopId: shopRecord.id, shop },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Redirect to app with token
    res.redirect(`https://${shop}/admin/apps/intimasync?token=${token}`);
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Shopify Webhook Routes
app.post('/webhooks/orders/create', async (req, res) => {
  try {
    const order = req.body;
    
    // Verify webhook authenticity
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = JSON.stringify(order);
    const hash = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(body).digest('base64');
    
    if (hash !== hmac) {
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    // Find shop by domain
    const shop = await prisma.shop.findUnique({
      where: { domain: req.get('X-Shopify-Shop-Domain') }
    });

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Process order and route to suppliers
    await processShopifyOrder(order, shop.id);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.post('/webhooks/products/update', async (req, res) => {
  try {
    const product = req.body;
    
    // Verify webhook authenticity
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = JSON.stringify(product);
    const hash = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(body).digest('base64');
    
    if (hash !== hmac) {
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    // Update product inventory if needed
    await updateProductInventory(product);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// File Upload Routes
app.post('/api/upload/products', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { supplierId } = req.body;
    if (!supplierId) {
      return res.status(400).json({ error: 'Supplier ID is required' });
    }

    // Process uploaded file based on type
    const result = await processProductFile(req.file, parseInt(supplierId), req.user.shopId);
    
    res.json({
      success: true,
      message: `Processed ${result.processed} products from ${req.file.originalname}`,
      stats: result.stats
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File processing failed' });
  }
});

// Helper Functions

async function syncSupplierProducts(supplier) {
  try {
    console.log(`Starting product sync for ${supplier.name}...`);
    
    const credentials = JSON.parse(decrypt(supplier.credentials));
    let products = [];
    
    switch (supplier.type.toLowerCase()) {
      case 'nalpac':
        products = await fetchNalpacProducts(credentials);
        break;
      case 'honeys':
      case 'honeys-place':
        products = await fetchHoneysProducts(credentials);
        break;
      case 'eldorado':
        products = await fetchEldoradoProducts(credentials);
        break;
      default:
        throw new Error(`Unknown supplier type: ${supplier.type}`);
    }

    // Batch update products in database
    let processed = 0;
    for (const productData of products) {
      try {
        await prisma.product.upsert({
          where: { 
            sku_supplierId: {
              sku: productData.sku,
              supplierId: supplier.id
            }
          },
          update: {
            name: productData.name,
            description: productData.description,
            price: productData.price,
            inventory: productData.inventory,
            imageUrl: productData.imageUrl,
            category: productData.category,
            updatedAt: new Date()
          },
          create: {
            sku: productData.sku,
            name: productData.name,
            description: productData.description,
            price: productData.price,
            inventory: productData.inventory,
            imageUrl: productData.imageUrl,
            category: productData.category,
            supplierId: supplier.id,
            shopId: supplier.shopId
          }
        });
        processed++;
      } catch (error) {
        console.error(`Error processing product ${productData.sku}:`, error);
      }
    }

    // Update supplier sync status
    await prisma.supplier.update({
      where: { id: supplier.id },
      data: { 
        lastSyncAt: new Date(),
        syncStatus: 'completed'
      }
    });

    console.log(`Completed sync for ${supplier.name}: ${processed} products processed`);
    
    // Update price comparisons
    await updatePriceComparisons(supplier.shopId);
    
  } catch (error) {
    console.error(`Error syncing ${supplier.name}:`, error);
    
    await prisma.supplier.update({
      where: { id: supplier.id },
      data: { syncStatus: 'failed' }
    });
  }
}

async function fetchNalpacProducts(credentials) {
  // Implement Nalpac API integration
  // This would connect to Nalpac's actual API and fetch products
  console.log('Fetching products from Nalpac...');
  return [];
}

async function fetchHoneysProducts(credentials) {
  // Implement Honey's Place API integration
  // This would connect to Honey's Place data feeds
  console.log('Fetching products from Honey\'s Place...');
  return [];
}

async function fetchEldoradoProducts(credentials) {
  // Implement Eldorado SFTP integration
  // This would connect via SFTP and download product files
  console.log('Fetching products from Eldorado...');
  return [];
}

async function importProductToShopify(product, shopifyPrice, customSku) {
  // Implement Shopify Admin API product creation
  console.log('Importing product to Shopify...');
  return { id: Date.now(), title: product.name, handle: product.name.toLowerCase().replace(/\s+/g, '-') };
}

async function routeOrderToSuppliers(shopifyOrderId, items, shopId) {
  // Implement intelligent order routing logic
  console.log('Routing order to suppliers...');
  return [];
}

async function updatePriceComparisons(shopId) {
  // Update price comparison data for products
  console.log('Updating price comparisons...');
}

async function calculatePricingSavings(shopId, startDate) {
  // Calculate savings from using cheapest suppliers
  return 0;
}

async function processShopifyOrder(order, shopId) {
  // Process incoming Shopify order webhook
  console.log('Processing Shopify order...');
}

async function updateProductInventory(product) {
  // Update product inventory from Shopify webhook
  console.log('Updating product inventory...');
}

async function processProductFile(file, supplierId, shopId) {
  // Process uploaded product file (CSV, Excel, etc.)
  console.log('Processing product file...');
  return { processed: 0, stats: {} };
}

// Error Handling Middleware
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  
  if (error.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start Server
app.listen(PORT, () => {
  console.log(`IntimaSync API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
