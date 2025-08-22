const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function authenticateToken(req, res, next) {
  req.user = { shopId: 1 };
  next();
}

app.get('/', (req, res) => {
  res.json({ name: 'IntimaSync API', status: 'operational' });
});

app.get('/app', (req, res) => {
  const { shop } = req.query;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>IntimaSync Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; background: #fafbfb; }
    .dashboard { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: white; padding: 24px; border-radius: 8px; margin-bottom: 20px; }
    .nav { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; }
    .nav button { padding: 12px 20px; margin-right: 10px; border: 1px solid #ccc; background: white; cursor: pointer; }
    .nav button.active { background: #5c6ac4; color: white; }
    .content { background: white; padding: 24px; border-radius: 8px; min-height: 400px; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <h1>IntimaSync</h1>
      <p>Multi-supplier inventory management for ${shop || 'your store'}</p>
    </div>
    
    <div class="nav">
      <button id="welcome-btn" class="active" onclick="showWelcome()">Welcome</button>
      <button id="suppliers-btn" onclick="showSuppliers()">Suppliers</button>
      <button id="products-btn" onclick="showProducts()">Products</button>
      <button id="orders-btn" onclick="showOrders()">Orders</button>
      <button id="settings-btn" onclick="showSettings()">Settings</button>
    </div>
    
    <div class="content" id="content">
      <h2>Welcome to IntimaSync!</h2>
      <p>Click the buttons above to navigate.</p>
    </div>
  </div>
  
  <script>
    let suppliers = [];
    
    function setActive(id) {
      document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }
    
    function showWelcome() {
      setActive('welcome-btn');
      document.getElementById('content').innerHTML = '<h2>Welcome!</h2><p>Your inventory management system.</p>';
    }
    
    function showSuppliers() {
      setActive('suppliers-btn');
      document.getElementById('content').innerHTML = '<h2>Suppliers</h2><p>Manage your supplier connections.</p>';
    }
    
    function showProducts() {
      setActive('products-btn');
      document.getElementById('content').innerHTML = '<h2>Products</h2><p>Sync and manage products.</p>';
    }
    
    function showOrders() {
      setActive('orders-btn');
      document.getElementById('content').innerHTML = '<h2>Orders</h2><p>View and manage orders.</p>';
    }
    
    function showSettings() {
      setActive('settings-btn');
      document.getElementById('content').innerHTML = '<h2>Settings</h2><p>Configure your suppliers.</p>';
    }
  </script>
</body>
</html>`);
});

app.get('/api/suppliers', authenticateToken, (req, res) => {
  res.json({ success: true, suppliers: [] });
});

app.post('/api/suppliers', authenticateToken, (req, res) => {
  res.json({ success: true, supplier: { id: 1, name: 'Test' } });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
