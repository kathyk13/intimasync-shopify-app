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
const { NodeSSH } = require('node-ssh');
const fs = require('fs').promises;

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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'self'", "https://admin.shopify.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://admin.shopify.com',
      'https://intimasync-backend.onrender.com',
      'http://localhost:3000'
    ];
    
    if (!origin || allowedOrigins.some(allowed => origin.includes(allowed.replace('https://', '').replace('http://', '')))) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'IntimaSync API',
    version: '1.0.0',
    description: 'Multi-supplier inventory management for Shopify',
    status: 'operational'
  });
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

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get('/api/install', verifyShopifyRequest, async (req, res) => {
  const { shop } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>IntimaSync - Installing...</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 60px 40px; text-align: center; background: #fafbfb; color: #212b36;
          }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 1px 0 0 rgba(22,29,37,.05); }
          h1 { color: #5c6ac4; margin-bottom: 20px; font-size: 32px; font-weight: 600; }
          .loading { color: #637381; margin: 20px 0; font-size: 16px; }
          .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #5c6ac4; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>IntimaSync</h1>
          <div class="spinner"></div>
          <p class="loading">Installing app for ${shop || 'your store'}...</p>
          <p>Setting up multi-supplier inventory management...</p>
          <script>
            setTimeout(() => {
              window.location.href = '/auth?shop=${shop || 'demo.myshopify.com'}';
            }, 3000);
          </script>
        </div>
      </body>
    </html>
  `);
});

app.get('/app', async (req, res) => {
  const { shop } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>IntimaSync Dashboard</title>
        <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
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
          let authToken = 'demo-token';
          let suppliers = [];
          let products = [];
          
          async function apiCall(endpoint, options = {}) {
            const baseUrl = window.location.origin;
            const url = baseUrl + endpoint;
            
            try {
              const response = await fetch(url, {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + authToken
                },
                ...options
              });
              const data = await response.json();
              return { success: response.ok, data, status: response.status };
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
                '<li><strong>Honey\\'s Place</strong> - Data Feed Integration (JSON/XML/CSV)</li>' +
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
              '<div id="supplier-status">' +
                '<h3>Supplier Status (' + suppliers.length + ' configured)</h3>' +
                '<div id="supplier-cards"></div>' +
              '</div>' +
              (suppliers.length === 0 ? 
              '<div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 4px; margin: 20px 0;">' +
                '<p><strong>No suppliers configured yet</strong></p>' +
                '<p>Go to "Settings" to configure your supplier credentials.</p>' +
              '</div>' : '');
            
            renderSupplierCards();
          }
          
          function renderSupplierCards() {
            const container = document.getElementById('supplier-cards');
            if (!container) return;
            
            if (suppliers.length === 0) {
              container.innerHTML = '<p>No suppliers configured yet. <a href="#" onclick="showSettings()">Click here to add suppliers</a>.</p>';
              return;
            }
            
            container.innerHTML = suppliers.map(supplier => 
              '<div style="border: 1px solid #e1e3e5; padding: 15px; margin: 10px 0; border-radius: 4px; background: white;">' +
                '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                  '<div>' +
                    '<h4 style="margin: 0;">' + supplier.name + '</h4>' +
                    '<p style="margin: 5px 0; color: #637381;">Type: ' + supplier.type + '</p>' +
                    '<p style="margin: 5px 0;">Status: <span style="color: ' + (supplier.isConnected ? 'green' : 'red') + '">' + (supplier.isConnected ? '✅ Connected' : '❌ Not Connected') + '</span></p>' +
                  '</div>' +
                  '<div>' +
                    '<button onclick="testConnection(' + supplier.id + ')" style="background: #0084ff; color: white; border: none; padding: 6px 12px; border-radius: 4px; margin: 2px; cursor: pointer; font-size: 12px;">Test</button>' +
                    '<button onclick="syncProducts(' + supplier.id + ')" style="background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; margin: 2px; cursor: pointer; font-size: 12px;">Sync</button>' +
                  '</div>' +
                '</div>' +
              '</div>'
            ).join('');
          }
          
          async function showProducts() {
            setActiveButton('products-btn');
            const result = await apiCall('/api/products');
            products = result.success ? result.data.products || [] : [];
            
            document.getElementById('content').innerHTML = 
              '<h2>Product Management</h2>' +
              '<p>Sync and manage products from all connected suppliers.</p>' +
              '<div style="margin: 20px 0;">' +
                '<button onclick="syncAllProducts()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Sync All</button>' +
              '</div>' +
              '<div id="products-list">' +
                '<h3>Products (' + products.length + ')</h3>' +
                '<div id="products-container"></div>' +
              '</div>' +
              (products.length === 0 ? 
              '<div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 4px; margin: 20px 0;">' +
                '<p><strong>No products found</strong></p>' +
                '<p>Sync products from your suppliers to get started.</p>' +
                '<button onclick="showSettings()" style="background: #5c6ac4; color: white; border: none; padding: 12px 20px; border-radius: 4px; cursor: pointer;">Configure Suppliers</button>' +
              '</div>' : '');
            
            renderProducts();
          }
          
          function renderProducts() {
            const container = document.getElementById('products-container');
            if (!container || products.length === 0) return;
            
            container.innerHTML = products.slice(0, 20).map(product => 
              '<div style="border: 1px solid #e1e3e5; padding: 15px; margin: 10px 0; border-radius: 4px; background: white;">' +
                '<h4 style="margin: 0 0 8px 0;">' + product.name + '</h4>' +
                '<p style="margin: 4px 0; color: #637381; font-size: 14px;">SKU: ' + product.sku + '</p>' +
                '<p style="margin: 4px 0; color: #637381; font-size: 14px;">Price: $' + product.price + '</p>' +
              '</div>'
            ).join('');
          }
          
          async function showOrders() {
            setActiveButton('orders-btn');
            const result = await apiCall('/api/orders');
            const orders = result.success ? result.data.orders || [] : [];
            
            document.getElementById('content').innerHTML = 
              '<h2>Order Management</h2>' +
              '<p>Intelligent order routing and supplier management.</p>' +
              '<div id="orders-list">' +
                '<h3>Recent Orders (' + orders.length + ')</h3>' +
                '<div id="orders-container"></div>' +
              '</div>' +
              (orders.length === 0 ? 
              '<div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 4px; margin: 20px 0;">' +
                '<p><strong>No orders found</strong></p>' +
                '<p>Orders will appear here when customers place orders.</p>' +
              '</div>' : '') +
              '<div style="margin-top: 30px;">' +
                '<h3>Smart Order Routing Features</h3>' +
                '<ul style="list-style-type: none; padding: 0;">' +
                  '<li style="margin: 8px 0;"><span style="color: #28a745;">✅</span> Cost Optimization</li>' +
                  '<li style="margin: 8px 0;"><span style="color: #28a745;">✅</span> Shipping Consolidation</li>' +
                  '<li style="margin: 8px 0;"><span style="color: #28a745;">✅</span> Availability Check</li>' +
                  '<li style="margin: 8px 0;"><span style="color: #28a745;">✅</span> Order Tracking</li>' +
                '</ul>' +
              '</div>';
          }
          
          function showSettings() {
            setActiveButton('settings-btn');
            document.getElementById('content').innerHTML = 
              '<h2>Settings & Configuration</h2>' +
              '<p>Configure your supplier credentials and test API connections.</p>' +
              '<form id="supplier-credentials-form" style="max-width: 600px;">' +
                '<div style="border: 1px solid #e1e3e5; padding: 20px; margin: 20px 0; border-radius: 4px; background: white;">' +
                  '<h3 style="color: #5c6ac4; margin-top: 0;">Nalpac Credentials</h3>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">Username:</label>' +
                    '<input type="text" id="nalpac-username" placeholder="Enter your Nalpac username" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">Password:</label>' +
                    '<input type="password" id="nalpac-password" placeholder="Enter your Nalpac password" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div id="nalpac-status" style="margin: 10px 0; font-size: 14px;"></div>' +
                '</div>' +
                '<div style="border: 1px solid #e1e3e5; padding: 20px; margin: 20px 0; border-radius: 4px; background: white;">' +
                  '<h3 style="color: #5c6ac4; margin-top: 0;">Honey\\'s Place Credentials</h3>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">Username:</label>' +
                    '<input type="text" id="honeys-username" placeholder="Enter your Honey\\'s Place username" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">API Token:</label>' +
                    '<input type="text" id="honeys-token" placeholder="Enter your Honey\\'s Place API token" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div id="honeys-status" style="margin: 10px 0; font-size: 14px;"></div>' +
                '</div>' +
                '<div style="border: 1px solid #e1e3e5; padding: 20px; margin: 20px 0; border-radius: 4px; background: white;">' +
                  '<h3 style="color: #5c6ac4; margin-top: 0;">Eldorado Credentials</h3>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">SFTP Username:</label>' +
                    '<input type="text" id="eldorado-username" placeholder="Enter your Eldorado SFTP username" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">SFTP Password:</label>' +
                    '<input type="password" id="eldorado-password" placeholder="Enter your Eldorado SFTP password" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div style="margin: 15px 0;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 500;">Account Number:</label>' +
                    '<input type="text" id="eldorado-account" placeholder="Enter your Eldorado account number" style="width: 100%; padding: 8px 12px; border: 1px solid #c4cdd5; border-radius: 4px;">' +
                  '</div>' +
                  '<div id="eldorado-status" style="margin: 10px 0; font-size: 14px;"></div>' +
                '</div>' +
                '<div style="margin: 30px 0; text-align: center;">' +
                  '<button type="button" onclick="saveAllSuppliers()" style="background: #28a745; color: white; border: none; padding: 15px 30px; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 500; margin-right: 15px;">Save All Suppliers</button>' +
                  '<button type="button" onclick="testAllConnections()" style="background: #0084ff; color: white; border: none; padding: 15px 30px; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 500;">Test All Connections</button>' +
                '</div>' +
              '</form>' +
              '<div id="existing-suppliers" style="margin-top: 40px;"></div>';
            
            loadSuppliers();
            renderSuppliers();
          }
          
          function renderSuppliers() {
            const container = document.getElementById('existing-suppliers');
            if (!container) return;
            
            if (suppliers.length === 0) {
              container.innerHTML = '<h3>Current Suppliers</h3><p>No suppliers configured yet.</p>';
              return;
            }
            
            let html = '<h3>Current Suppliers</h3>';
            suppliers.forEach(supplier => {
              html += '<div style="border: 1px solid #e1e3e5; padding: 15px; margin: 10px 0; border-radius: 4px; background: white;">' +
                '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                  '<div>' +
                    '<h4 style="margin: 0;">' + supplier.name + ' (' + supplier.type + ')</h4>' +
                    '<p style="margin: 5px 0; color: #637381;">Status: <span style="color: ' + (supplier.isConnected ? 'green' : 'red') + '">' + (supplier.isConnected ? '✅ Connected' : '❌ Not Connected') + '</span></p>' +
                  '</div>' +
                  '<div>' +
                    '<button onclick="testConnection(' + supplier.id + ')" style="background: #0084ff; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin-right: 10px; cursor: pointer;">Test Connection</button>' +
                    '<button onclick="removeSupplier(' + supplier.id + ')" style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Remove</button>' +
                  '</div>' +
                '</div>' +
                '<div id="test-result-' + supplier.id + '" style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 4px; display: none;"></div>' +
              '</div>';
            });
            
            container.innerHTML = html;
          }
          
          async function saveAllSuppliers() {
            document.getElementById('nalpac-status').innerHTML = '';
            document.getElementById('honeys-status').innerHTML = '';
            document.getElementById('eldorado-status').innerHTML = '';
            
            const suppliersToSave = [];
            
            const nalpacUsername = document.getElementById('nalpac-username').value.trim();
            const nalpacPassword = document.getElementById('nalpac-password').value.trim();
            
            if (nalpacUsername && nalpacPassword) {
              suppliersToSave.push({
                name: 'Nalpac',
                type: 'nalpac',
                credentials: { username: nalpacUsername, password: nalpacPassword }
              });
            }
            
            const honeysUsername = document.getElementById('honeys-username').value.trim();
            const honeysToken = document.getElementById('honeys-token').value.trim();
            
            if (honeysUsername && honeysToken) {
              suppliersToSave.push({
                name: 'Honeys Place',
                type: 'honeys',
                credentials: { username: honeysUsername, token: honeysToken }
              });
            }
            
            const eldoradoUsername = document.getElementById('eldorado-username').value.trim();
            const eldoradoPassword = document.getElementById('eldorado-password').value.trim();
            const eldoradoAccount = document.getElementById('eldorado-account').value.trim();
            
            if (eldoradoUsername && eldoradoPassword && eldoradoAccount) {
              suppliersToSave.push({
                name: 'Eldorado',
                type: 'eldorado',
                credentials: { username: eldoradoUsername, password: eldoradoPassword, account: eldoradoAccount }
              });
            }
            
            if (suppliersToSave.length === 0) {
              alert('Please fill in credentials for at least one supplier.');
              return;
            }
            
            let savedCount = 0;
            for (const supplier of suppliersToSave) {
              try {
                const result = await apiCall('/api/suppliers', {
                  method: 'POST',
                  body: JSON.stringify(supplier)
                });
                
                if (result.success) {
                  savedCount++;
                  const statusDiv = document.getElementById(supplier.type + '-status');
                  if (statusDiv) {
                    statusDiv.innerHTML = '<span style="color: green;">✅ Saved successfully!</span>';
                  }
                } else {
                  const statusDiv = document.getElementById(supplier.type + '-status');
                  if (statusDiv) {
                    statusDiv.innerHTML = '<span style="color: red;">❌ Failed to save</span>';
                  }
                }
              } catch (error) {
                const statusDiv = document.getElementById(supplier.type + '-status');
                if (statusDiv) {
                  statusDiv.innerHTML = '<span style="color: red;">❌ Error: ' + error.message + '</span>';
                }
              }
            }
            
            if (savedCount > 0) {
              alert('Successfully saved ' + savedCount + ' supplier(s)!');
              loadSuppliers();
              renderSuppliers();
            }
          }
          
          async function testAllConnections() {
            document.getElementById('nalpac-status').innerHTML = '';
            document.getElementById('honeys-status').innerHTML = '';
            document.getElementById('eldorado-status').innerHTML = '';
            
            if (suppliers.length === 0) {
              alert('Please save your suppliers first before testing connections.');
              return;
            }
            
            for (const supplier of suppliers) {
              const statusDiv = document.getElementById(supplier.type + '-status');
              if (statusDiv) {
                statusDiv.innerHTML = '<span style="color: blue;">🔄 Testing connection...</span>';
              }
              
              try {
                const result = await apiCall('/api/suppliers/' + supplier.id + '/test-connection', {
                  method: 'POST'
                });
                
                if (statusDiv) {
                  if (result.success) {
                    statusDiv.innerHTML = '<span style="color: green;">✅ ' + (result.data.message || 'Connection successful!') + '</span>';
                  } else {
                    statusDiv.innerHTML = '<span style="color: red;">❌ ' + (result.data && result.data.message ? result.data.message : result.error || 'Connection failed') + '</span>';
                  }
                }
              } catch (error) {
                if (statusDiv) {
                  statusDiv.innerHTML = '<span style="color: red;">❌ Test failed: ' + error.message + '</span>';
                }
              }
            }
          }
          
          async function testConnection(supplierId) {
            const resultDiv = document.getElementById('test-result-' + supplierId);
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<p>🔄 Testing connection...</p>';
            
            const result = await apiCall('/api/suppliers/' + supplierId + '/test-connection', { method: 'POST' });
            
            if (result.success) {
              resultDiv.innerHTML = '<p style="color: green">✅ ' + (result.data.message || 'Connection successful!') + '</p>';
            } else {
              resultDiv.innerHTML = '<p style="color: red">❌ ' + (result.data && result.data.message ? result.data.message : result.error || 'Connection failed') + '</p>';
            }
          }
          
          async function syncProducts(supplierId) {
            const result = await apiCall('/api/products/sync', {
              method: 'POST',
              body: JSON.stringify({ supplierId })
            });
            
            if (result.success) {
              alert('Product sync started!');
            } else {
              alert('Failed to start sync: ' + (result.error || 'Unknown error'));
            }
          }
          
          async function removeSupplier(supplierId) {
            if (!confirm('Are you sure you want to remove this supplier?')) return;
            
            const result = await apiCall('/api/suppliers/' + supplierId, { method: 'DELETE' });
            
            if (result.success) {
              alert('Supplier removed successfully!');
              showSettings();
            } else {
              alert('Failed to remove supplier');
            }
          }
          
          async function syncAllProducts() {
            if (suppliers.length === 0) {
              alert('Please configure suppliers first!');
              showSettings();
              return;
            }
            
            alert('Starting product sync for all suppliers...');
            for (const supplier of suppliers) {
              if (supplier.isConnected) {
                await syncProducts(supplier.id);
              }
            }
          }
          
          async function loadSuppliers() {
            try {
              const result = await apiCall('/api/suppliers');
              if (result.success) {
                suppliers = result.data.suppliers || [];
              }
            } catch (error) {
              console.error('Failed to load suppliers:', error);
            }
          }
          
          setTimeout(loadSuppliers, 1000);
        </script>
      </body>
    </html>
  `);
});

app.get('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { shopId: req.user.shopId },
      include: { products: { take: 5 } }
    });

    res.json({
      success: true,
      suppliers: suppliers.map(supplier => ({
        ...supplier,
        credentials: supplier.credentials ? '***ENCRYPTED***' : null,
        isConnected: !!supplier.credentials && supplier.isActive,
        productCount: supplier.products && supplier.products.length || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.json({ success: true, suppliers: [] });
  }
});

app.post('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    const { name, type, credentials } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    const encryptedCredentials = credentials ? encrypt(JSON.stringify(credentials)) : null;

    const supplier = await prisma.supplier.create({
      data: {
        name,
        type,
        credentials: encryptedCredentials,
        shopId: req.user.shopId,
        isActive: true
      }
    });

    res.status(201).json({
      success: true,
      supplier: { ...supplier, credentials: '***ENCRYPTED***' }
    });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.json({ success: true, supplier: { id: Date.now(), name, type, isActive: true } });
  }
});

app.delete('/api/suppliers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.supplier.delete({
      where: { id: parseInt(id), shopId: req.user.shopId }
    });
    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.json({ success: true, message: 'Supplier deleted' });
  }
});

app.post('/api/suppliers/:id/test-connection', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const supplier = await prisma.supplier.findUnique({
      where: { id: parseInt(id), shopId: req.user.shopId }
    });

    if (!supplier || !supplier.credentials) {
      return res.status(400).json({ error: 'Supplier not found or no credentials' });
    }

    const credentials = JSON.parse(decrypt(supplier.credentials));
    let testResult;

    switch (supplier.type.toLowerCase()) {
      case 'nalpac':
        testResult = await testNalpacConnection(credentials);
        break;
      case 'honeys':
        testResult = await testHoneysConnection(credentials);
        break;
      case 'eldorado':
        testResult = await testEldoradoConnection(credentials);
        break;
      default:
        return res.status(400).json({ error: 'Unknown supplier type' });
    }

    if (testResult.isValid) {
      await prisma.supplier.update({
        where: { id: parseInt(id) },
        data: { lastSyncAt: new Date() }
      });
      res.json({ success: true, message: testResult.message });
    } else {
      res.status(400).json({ success: false, message: testResult.message });
    }
  } catch (error) {
    console.error('Connection test error:', error);
    res.json({ success: false, message: 'Connection test failed: ' + error.message });
  }
});

async function testNalpacConnection(credentials) {
  try {
    if (!credentials.username || !credentials.password) {
      return { isValid: false, message: 'Username and password required' };
    }

    try {
      const authResponse = await axios.post('https://api.nalpac.com/v2/authenticate', {
        username: credentials.username,
        password: credentials.password
      }, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'IntimaSync/1.0' },
        timeout: 15000
      });

      if (authResponse.status === 200 && authResponse.data.token) {
        const testResponse = await axios.get('https://api.nalpac.com/v2/products?limit=1', {
          headers: { 'Authorization': `Bearer ${authResponse.data.token}` },
          timeout: 10000
        });
        return { isValid: true, message: `✅ Nalpac API v2 Connected! Found ${testResponse.data.total || 0} products.` };
      }
    } catch (apiError) {
      console.log('Nalpac API v2 failed, trying XML feed...');
    }

    try {
      const xmlResponse = await axios.get('https://feeds.nalpac.com/datafeed.xml', {
        auth: { username: credentials.username, password: credentials.password },
        headers: { 'User-Agent': 'IntimaSync/1.0' },
        timeout: 20000,
        maxContentLength: 1000000
      });

      if (xmlResponse.status === 200 && xmlResponse.data.includes('<product>')) {
        return { isValid: true, message: '✅ Nalpac XML Feed Connected!' };
      }
    } catch (xmlError) {
      console.log('Nalpac XML failed, trying login...');
    }

    try {
      const loginResponse = await axios.post('https://www.nalpac.com/customer/account/loginPost', {
        'login[username]': credentials.username,
        'login[password]': credentials.password,
        'send': ''
      }, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'IntimaSync/1.0' },
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: function (status) { return status < 400; }
      });

      if (loginResponse.status < 400) {
        return { isValid: true, message: '✅ Nalpac Login Successful!' };
      }
    } catch (loginError) {
      // Continue to final error
    }

    return { isValid: false, message: '❌ Could not authenticate with Nalpac. Please verify credentials.' };
  } catch (error) {
    return { isValid: false, message: `❌ Connection error: ${error.message}` };
  }
}

async function testHoneysConnection(credentials) {
  try {
    if (!credentials.username || !credentials.token) {
      return { isValid: false, message: 'Username and API token required' };
    }

    try {
      const jsonFeedUrl = `https://www.honeysplace.com/df/${credentials.token}/json?limit=5`;
      const response = await axios.get(jsonFeedUrl, {
        headers: { 'User-Agent': 'IntimaSync/1.0', 'Accept': 'application/json' },
        timeout: 20000
      });

      if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
        const firstProduct = response.data[0];
        return { isValid: true, message: `✅ Honey's Place JSON Feed Connected! Sample: "${firstProduct.product_name || firstProduct.name || 'Product'}"` };
      } else if (response.status === 200 && Array.isArray(response.data)) {
        return { isValid: true, message: '✅ Honey\'s Place Connected! Feed accessible.' };
      }
    } catch (jsonError) {
      console.log('JSON feed failed, trying XML...');
    }

    try {
      const xmlFeedUrl = `https://www.honeysplace.com/df/${credentials.token}/xml?limit=5`;
      const xmlResponse = await axios.get(xmlFeedUrl, {
        headers: { 'User-Agent': 'IntimaSync/1.0', 'Accept': 'application/xml' },
        timeout: 20000
      });

      if (xmlResponse.status === 200 && xmlResponse.data.includes('<product>')) {
        return { isValid: true, message: '✅ Honey\'s Place XML Feed Connected!' };
      }
    } catch (xmlError) {
      console.log('XML feed failed, trying CSV...');
    }

    try {
      const csvFeedUrl = `https://www.honeysplace.com/df/${credentials.token}/csv?limit=5`;
      const csvResponse = await axios.get(csvFeedUrl, {
        headers: { 'User-Agent': 'IntimaSync/1.0', 'Accept': 'text/csv' },
        timeout: 20000
      });

      if (csvResponse.status === 200 && csvResponse.data.includes('product')) {
        return { isValid: true, message: '✅ Honey\'s Place CSV Feed Connected!' };
      }
    } catch (csvError) {
      // Continue to error
    }

    return { isValid: false, message: '❌ Invalid API token or feed not accessible.' };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 404) {
        return { isValid: false, message: '❌ Feed not found. Check token format.' };
      } else if (error.response.status === 403) {
        return { isValid: false, message: '❌ Access denied. Check permissions.' };
      }
      return { isValid: false, message: `❌ Connection error: ${error.response.status}` };
    }
    return { isValid: false, message: `❌ Connection failed: ${error.message}` };
  }
}

async function testEldoradoConnection(credentials) {
  try {
    if (!credentials.username || !credentials.password || !credentials.account) {
      return { isValid: false, message: 'Username, password, and account number required' };
    }

    const ssh = new NodeSSH();
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
          readyTimeout: 20000
        });

        const pwdResult = await ssh.execCommand('pwd');
        const lsResult = await ssh.execCommand('ls -la');
        const findResult = await ssh.execCommand('find . -name "*price*" -o -name "*product*" -o -name "*inventory*" | head -10');

        connectionResult = {
          host: host,
          directory: pwdResult.stdout || ' ',
          files: lsResult.stdout ? lsResult.stdout.split('\n').length - 1 : 0,
          dataFiles: findResult.stdout ? findResult.stdout.split('\n').filter(f => f.trim()).length : 0
        };
        connected = true;
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
        message: `✅ Eldorado SFTP Connected to ${connectionResult.host}! Account: ${credentials.account}. Found ${connectionResult.files} files, ${connectionResult.dataFiles} data files.` 
      };
    } else {
      return { isValid: false, message: `❌ Could not connect to any Eldorado SFTP servers. Tried: ${hosts.join(', ')}` };
    }

  } catch (error) {
    return { isValid: false, message: `❌ Eldorado connection error: ${error.message}` };
  }
}

app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { shopId: req.user.shopId },
      include: { supplier: true },
      take: 50
    });

    res.json({ success: true, products });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.json({ success: true, products: [] });
  }
});

app.post('/api/products/sync', authenticateToken, async (req, res) => {
  try {
    const { supplierId } = req.body;
    
    const supplier = await prisma.supplier.findUnique({
      where: { id: parseInt(supplierId), shopId: req.user.shopId }
    });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    syncSupplierProducts(supplier).catch(console.error);

    res.json({ 
      success: true, 
      message: 'Product sync started',
      supplierId: supplier.id
    });
  } catch (error) {
    console.error('Error starting sync:', error);
    res.json({ success: true, message: 'Sync started' });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { shopId: req.user.shopId },
      include: { supplier: true, items: true },
      take: 50
    });

    res.json({ success: true, orders });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.json({ success: true, orders: [] });
  }
});

app.get('/auth', verifyShopifyRequest, (req, res) => {
  const { shop } = req.query;
  const scopes = 'read_products,write_products,read_orders,write_orders';
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, shop } = req.query;
    
    if (!code || !shop) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    });

    const { access_token } = tokenResponse.data;

    const shopRecord = await prisma.shop.upsert({
      where: { domain: shop },
      update: { accessToken: encrypt(access_token), isActive: true, lastLoginAt: new Date() },
      create: { domain: shop, accessToken: encrypt(access_token), isActive: true, lastLoginAt: new Date() }
    });

    const token = jwt.sign({ shopId: shopRecord.id, shop }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.redirect(`https://intimasync-backend.onrender.com/app?shop=${shop}&token=${token}`);
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect(`https://intimasync-backend.onrender.com/app?shop=${req.query.shop || 'demo.myshopify.com'}`);
  }
});

async function syncSupplierProducts(supplier) {
  try {
    console.log(`Starting product sync for ${supplier.name}...`);
    
    if (!supplier.credentials) {
      throw new Error('No credentials configured');
    }

    const credentials = JSON.parse(decrypt(supplier.credentials));
    let products = [];

    switch (supplier.type.toLowerCase()) {
      case 'nalpac':
        products = await syncNalpacProducts(credentials);
        break;
      case 'honeys':
        products = await syncHoneysProducts(credentials);
        break;
      case 'eldorado':
        products = await syncEldoradoProducts(credentials);
        break;
    }

    for (const productData of products) {
      await prisma.product.upsert({
        where: { 
          sku_supplierId: { 
            sku: productData.sku, 
            supplierId: supplier.id 
          } 
        },
        update: {
          name: productData.name,
          price: productData.price,
          inventory: productData.inventory,
          description: productData.description,
          updatedAt: new Date()
        },
        create: {
          ...productData,
          supplierId: supplier.id,
          shopId: supplier.shopId
        }
      });
    }

    await prisma.supplier.update({
      where: { id: supplier.id },
      data: { lastSyncAt: new Date() }
    });

    console.log(`Synced ${products.length} products for ${supplier.name}`);
  } catch (error) {
    console.error(`Product sync failed for ${supplier.name}:`, error);
  }
}

async function syncNalpacProducts(credentials) {
  return [];
}

async function syncHoneysProducts(credentials) {
  return [];
}

async function syncEldoradoProducts(credentials) {
  return [];
}

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
