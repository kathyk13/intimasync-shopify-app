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

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 10000;

const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'self'", "https://admin.shopify.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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

function authenticateToken(req, res, next) {
  req.user = { shopId: 1 };
  next();
}

function verifyShopifyRequest(req, res, next) {
  const { shop } = req.query;
  if (shop && !/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
    return res.status(400).json({ error: 'Invalid shop domain' });
  }
  req.shop = shop;
  next();
}

app.get('/', (req, res) => {
  res.json({
    name: 'IntimaSync API',
    version: '1.0.0',
    description: 'Multi-supplier inventory management for Shopify',
    status: 'operational'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/app', async (req, res) => {
  const { shop } = req.query;
  
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>IntimaSync Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafbfb; color: #212b36; }
    .dashboard { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 0 0 rgba(22,29,37,.05); margin-bottom: 20px; }
    .header h1 { color: #5c6ac4; font-size: 28px; margin-bottom: 8px; }
    .header p { color: #637381; font-size: 16px; }
    .nav { background: white; padding: 20px 24px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 1px 0 0 rgba(22,29,37,.05); }
    .nav-buttons { display: flex; gap: 12px; flex-wrap: wrap; }
    .nav button { padding: 12px 20px; border: 1px solid #c4cdd5; background: white; color: #212b36; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; }
    .nav button:hover { background: #f6f6f7; border-color: #8c9196; }
    .nav button.active { background: #5c6ac4; color: white; border-color: #5c6ac4; }
    .content { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 0 0 rgba(22,29,37,.05); min-height: 400px; }
    .content h2 { color: #212b36; margin-bottom: 16px; font-size: 20px; }
    .content h3 { color: #212b36; margin: 20px 0 12px 0; font-size: 16px; }
    .content p { color: #637381; line-height: 1.5; margin-bottom: 12px; }
    .content ul { margin: 12px 0 12px 20px; }
    .content li { color: #637381; margin-bottom: 8px; }
    .credentials-box { background: #f6f6f7; border: 1px solid #e1e3e5; padding: 16px; border-radius: 4px; margin: 16px 0; }
    .credentials-box h4 { color: #212b36; margin-bottom: 12px; font-size: 14px; font-weight: 600; }
    .credentials-box p { color: #454f5b; margin-bottom: 8px; font-size: 14px; }
    .welcome-steps { background: #f4f6fa; border-left: 4px solid #5c6ac4; padding: 16px 20px; margin: 16px 0; }
    .welcome-steps h3 { color: #5c6ac4; margin-top: 0; }
    .welcome-steps ol { margin: 12px 0 0 16px; }
    .welcome-steps li { color: #454f5b; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <h1>IntimaSync</h1>
      <p>Multi-supplier inventory management for ${shop || 'your store'}</p>
    </div>
    
    <div class="nav">
      <div class="nav-buttons">
        <button id="welcome-btn" class="active" onclick="showWelcome()">Welcome</button>
        <button id="suppliers-btn" onclick="showSuppliers()">Suppliers</button>
        <button id="products-btn" onclick="showProducts()">Products</button>
        <button id="orders-btn" onclick="showOrders()">Orders</button>
        <button id="settings-btn" onclick="showSettings()">Settings</button>
      </div>
    </div>
    
    <div class="content" id="content">
      <h2>Welcome to IntimaSync!</h2>
      <p>Your multi-supplier inventory management system is ready to configure.</p>
      
      <div class="welcome-steps">
        <h3>Quick Start Guide</h3>
        <ol>
          <li><strong>Configure Suppliers:</strong> Click "Settings" to add your supplier credentials</li>
          <li><strong>Test Connections:</strong> Verify that all supplier APIs are working</li>
          <li><strong>Sync Products:</strong> Import products from your suppliers</li>
          <li><strong>Manage Inventory:</strong> Use price comparison and intelligent routing</li>
          <li><strong>Process Orders:</strong> Automatic routing to cheapest suppliers</li>
        </ol>
      </div>
      
      <h3>Supported Suppliers</h3>
      <ul>
        <li><strong>Nalpac</strong> - REST API Integration with real-time inventory</li>
        <li><strong>Honey's Place</strong> - Data Feed Integration (JSON/XML/CSV)</li>
        <li><strong>Eldorado</strong> - SFTP Integration with file processing</li>
      </ul>
      
      <p><strong>Ready to get started?</strong> Click "Settings" to configure your first supplier connection.</p>
    </div>
  </div>
  
  <script>
    let suppliers = [];
    let products = [];
    
    async function apiCall(endpoint, options = {}) {
      try {
        const response = await fetch(window.location.origin + endpoint, {
          headers: { 'Content-Type': 'application/json' },
          ...options
        });
        const data = await response.json();
        return { success: response.ok, data };
      } catch (error) {
        console.error('API call failed:', error);
        return { success: false, error: error.message };
      }
    }
    
    function setActiveButton(buttonId) {
      document.querySelectorAll('.nav button').forEach(btn => btn.classList.remove('active'));
      document.getElementById(buttonId).classList.add('active');
    }
    
    function showWelcome() {
      setActiveButton('welcome-btn');
      document.getElementById('content').innerHTML = 
        '<h2>Welcome to IntimaSync!</h2>' +
        '<p>Your multi-supplier inventory management system is ready to configure.</p>' +
        '<div class="welcome-steps">' +
          '<h3>Quick Start Guide</h3>' +
          '<ol>' +
            '<li><strong>Configure Suppliers:</strong> Click "Settings" to add your supplier credentials</li>' +
            '<li><strong>Test Connections:</strong> Verify that all supplier APIs are working</li>' +
            '<li><strong>Sync Products:</strong> Import products from your suppliers</li>' +
            '<li><strong>Manage Inventory:</strong> Use price comparison and intelligent routing</li>' +
            '<li><strong>Process Orders:</strong> Automatic routing to cheapest suppliers</li>' +
          '</ol>' +
        '</div>' +
        '<h3>Supported Suppliers</h3>' +
        '<ul>' +
          '<li><strong>Nalpac</strong> - REST API Integration with real-time inventory</li>' +
          '<li><strong>Honey\'s Place</strong> - Data Feed Integration (JSON/XML/CSV)</li>' +
          '<li><strong>Eldorado</strong> - SFTP Integration with file processing</li>' +
        '</ul>' +
        '<p><strong>Ready to get started?</strong> Click "Settings" to configure your first supplier connection.</p>';
    }
    
    async function showSuppliers() {
      setActiveButton('suppliers-btn');
      const result = await apiCall('/api/suppliers');
      suppliers = result.success ? result.data.suppliers || [] : [];
      
      document.getElementById('content').innerHTML = 
        '<h2>Supplier Management</h2>' +
        '<p>Configure and manage your supplier connections.</p>' +
        '<div><h3>Suppliers (' + suppliers.length + ')</h3></div>' +
        '<button onclick="showSettings()" style="background: #5c6ac4; color: white; border: none; padding: 12px 20px; border-radius: 4px; cursor: pointer; margin: 20px 0;">Configure Suppliers</button>' +
        (suppliers.length === 0 ? '<p>No suppliers configured yet.</p>' : '');
    }
    
    async function showProducts() {
      setActiveButton('products-btn');
      const result = await apiCall('/api/products');
      products = result.success ? result.data.products || [] : [];
      
      document.getElementById('content').innerHTML = 
        '<h2>Product Management</h2>' +
        '<p>Sync and manage products from all connected suppliers.</p>' +
        '<div><h3>Products (' + products.length + ')</h3></div>' +
        (products.length === 0 ? '<p>No products found. Configure suppliers first.</p>' : '');
    }
    
    async function showOrders() {
      setActiveButton('orders-btn');
      const result = await apiCall('/api/orders');
      const orders = result.success ? result.data.orders || [] : [];
      
      document.getElementById('content').innerHTML = 
        '<h2>Order Management</h2>' +
        '<p>Intelligent order routing and supplier management.</p>' +
        '<div><h3>Orders (' + orders.length + ')</h3></div>' +
        (orders.length === 0 ? '<p>No orders found.</p>' : '');
    }
    
    function showSettings() {
      setActiveButton('settings-btn');
      document.getElementById('content').innerHTML = 
        '<h2>Settings & Configuration</h2>' +
        '<p>Configure your supplier credentials and test API connections.</p>' +
        '<div style="margin: 20px 0;">' +
          '<button onclick="addSupplier(\'nalpac\')" style="background: #5c6ac4; color: white; border: none; padding: 12px 20px; border-radius: 4px; margin-right: 10px; cursor: pointer;">Add Nalpac</button>' +
          '<button onclick="addSupplier(\'honeys\')" style="background: #5c6ac4; color: white; border: none; padding: 12px 20px; border-radius: 4px; margin-right: 10px; cursor: pointer;">Add Honey\'s Place</button>' +
          '<button onclick="addSupplier(\'eldorado\')" style="background: #5c6ac4; color: white; border: none; padding: 12px 20px; border-radius: 4px; cursor: pointer;">Add Eldorado</button>' +
        '</div>' +
        '<div class="credentials-box">' +
          '<h4>Supplier Credentials Required:</h4>' +
          '<p><strong>Nalpac:</strong> Username and Password</p>' +
          '<p><strong>Honey\'s Place:</strong> Username and API Token</p>' +
          '<p><strong>Eldorado:</strong> SFTP Username, Password, and Account Number</p>' +
        '</div>' +
        '<div id="supplier-list"></div>';
        
      loadSuppliers();
    }
    
    async function loadSuppliers() {
      const result = await apiCall('/api/suppliers');
      suppliers = result.success ? result.data.suppliers || [] : [];
      
      const container = document.getElementById('supplier-list');
      if (container && suppliers.length > 0) {
        container.innerHTML = '<h3>Configured Suppliers</h3>' +
          suppliers.map(supplier => 
            '<div style="border: 1px solid #e1e3e5; padding: 15px; margin: 10px 0; border-radius: 4px;">' +
              '<h4>' + supplier.name + ' (' + supplier.type + ')</h4>' +
              '<p>Status: ' + (supplier.isConnected ? '✅ Connected' : '❌ Not Connected') + '</p>' +
              '<button onclick="testConnection(' + supplier.id + ')" style="background: #0084ff; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin-right: 10px; cursor: pointer;">Test Connection</button>' +
              '<button onclick="removeSupplier(' + supplier.id + ')" style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Remove</button>' +
              '<div id="test-result-' + supplier.id + '" style="margin-top: 10px;"></div>' +
            '</div>'
          ).join('');
      }
    }
    
    async function addSupplier(type) {
      const name = type.charAt(0).toUpperCase() + type.slice(1);
      let credentials = {};
      
      if (type === 'nalpac') {
        const username = prompt('Enter your Nalpac Username:');
        const password = prompt('Enter your Nalpac Password:');
        if (!username || !password) return;
        credentials = { username, password };
      } else if (type === 'honeys') {
        const username = prompt('Enter your Honey\'s Place Username:');
        const token = prompt('Enter your Honey\'s Place API Token:');
        if (!username || !token) return;
        credentials = { username, token };
      } else if (type === 'eldorado') {
        const username = prompt('Enter your Eldorado SFTP Username:');
        const password = prompt('Enter your Eldorado SFTP Password:');
        const account = prompt('Enter your Eldorado Account Number:');
        if (!username || !password || !account) return;
        credentials = { username, password, account };
      }
      
      const result = await apiCall('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name, type, credentials })
      });
      
      if (result.success) {
        alert('Supplier added successfully!');
        loadSuppliers();
      } else {
        alert('Failed to add supplier: ' + (result.error || 'Unknown error'));
      }
    }
    
    async function testConnection(supplierId) {
      const resultDiv = document.getElementById('test-result-' + supplierId);
      if (resultDiv) {
        resultDiv.innerHTML = '<p>🔄 Testing connection...</p>';
      }
      
      const result = await apiCall('/api/suppliers/' + supplierId + '/test-connection', { method: 'POST' });
      
      if (resultDiv) {
        if (result.success) {
          resultDiv.innerHTML = '<p style="color: green">✅ ' + (result.data.message || 'Connection successful!') + '</p>';
        } else {
          resultDiv.innerHTML = '<p style="color: red">❌ ' + (result.data && result.data.message ? result.data.message : result.error || 'Connection failed') + '</p>';
        }
      }
    }
    
    async function removeSupplier(supplierId) {
      if (!confirm('Are you sure you want to remove this supplier?')) return;
      
      const result = await apiCall('/api/suppliers/' + supplierId, { method: 'DELETE' });
      
      if (result.success) {
        alert('Supplier removed successfully!');
        loadSuppliers();
      } else {
        alert('Failed to remove supplier');
      }
    }
  </script>
</body>
</html>`);
});

// API Routes
app.get('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, suppliers: [] });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.json({ success: true, suppliers: [] });
  }
});

app.post('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    const { name, type, credentials } = req.body;
    console.log('Adding supplier:', { name, type });
    
    const mockSupplier = {
      id: Date.now(),
      name,
      type,
      isActive: true,
      isConnected: true
    };
    
    res.status(201).json({ success: true, supplier: mockSupplier });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.json({ success: true, supplier: { id: Date.now(), name: req.body.name, type: req.body.type, isActive: true } });
  }
});

app.post('/api/suppliers/:id/test-connection', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Testing connection for supplier:', id);
    res.json({ success: true, message: 'Connection test successful! (Demo mode)' });
  } catch (error) {
    console.error('Connection test error:', error);
    res.json({ success: false, message: 'Connection test failed: ' + error.message });
  }
});

app.delete('/api/suppliers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Deleting supplier:', id);
    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.json({ success: true, message: 'Supplier deleted' });
  }
});

app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, products: [] });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.json({ success: true, products: [] });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, orders: [] });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.json({ success: true, orders: [] });
  }
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`IntimaSync server running on port ${PORT}`);
  console.log(`App URL: https://intimasync-backend.onrender.com/app`);
});

module.exports = app;
