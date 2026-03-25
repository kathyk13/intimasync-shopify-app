# IntimaSync - Step-by-Step Setup Guide
### For Kathy K. | Version 1.0

This guide walks you through everything from zero to a live, testable IntimaSync installation on your dev store.

---

## BEFORE YOU START: What You'll Need

- Shopify Partners account (partners.shopify.com)
- GitHub account (github.com)
- Render.com account (render.com) - sign up with your GitHub
- Supabase account (supabase.com) - free tier
- Node.js 20+ installed on your computer
- Your supplier API credentials (Eldorado key, Honey's Place API token, Nalpac username/password)

---

## PHASE 1: Set Up Your Database (Supabase)

**Time: 10 minutes**

1. Go to supabase.com and click "Start your project"
2. Sign in with GitHub
3. Click "New project"
   - Organization: your name
   - Project name: `intimasync`
   - Password: (save this somewhere safe)
   - Region: US East or US West
4. Wait about 2 minutes for the project to spin up
5. Click "Settings" (left sidebar) > "Database"
6. Scroll down to "Connection string" and click "URI"
7. Copy the full connection string (it starts with `postgresql://`)
8. SAVE THIS - you will need it in Phase 3

---

## PHASE 2: Set Up GitHub

**Time: 5 minutes**

1. Go to github.com
2. Click the "+" button > "New repository"
3. Repository name: `intimasync`
4. Make it Private
5. Click "Create repository"
6. Follow the instructions to upload the code folder (you'll drag and drop the `intimasync` folder)
   - OR: If you have GitHub Desktop installed, add the `intimasync` folder as a local repository and push to this new repo

---

## PHASE 3: Deploy to Render.com

**Time: 15 minutes**

1. Go to render.com and click "Get Started for Free"
2. Sign in with GitHub
3. Click "New +" > "Web Service"
4. Connect your `intimasync` GitHub repository
5. Configure:
   - Name: `intimasync`
   - Region: Oregon
   - Branch: main
   - Build Command: `npm install && npm run setup`
   - Start Command: `npm run start`
   - Plan: **Starter ($7/month)** - this gives you a STATIC IP (required by Eldorado)
6. Scroll down to "Environment Variables" and add:
   ```
   SHOPIFY_API_KEY       = (you'll add this after Step 4)
   SHOPIFY_API_SECRET    = (you'll add this after Step 4)
   SHOPIFY_APP_URL       = https://intimasync.onrender.com
   DATABASE_URL          = (your Supabase connection string from Phase 1)
   SCOPES                = read_products,write_products,read_orders,write_orders,read_inventory,write_inventory,read_fulfillments,write_fulfillments
   ENCRYPTION_KEY        = (click "Generate" to create a random string)
   ```
7. Click "Create Web Service"
8. Wait for the first deploy to finish (about 5-10 minutes)
9. Note your app URL: it will be something like `https://intimasync.onrender.com`

---

## PHASE 4: Create the Shopify App

**Time: 10 minutes**

1. Go to partners.shopify.com
2. Click "Apps" in the left sidebar
3. Click "Create app" > "Create app manually"
4. Fill in:
   - App name: **IntimaSync**
   - App URL: `https://intimasync.onrender.com`
5. Click "Create app"
6. On the next screen, copy your **Client ID** and **Client Secret**
7. Click "App setup" in the left sidebar
8. Under "URLs", set:
   - App URL: `https://intimasync.onrender.com`
   - Allowed redirection URLs: `https://intimasync.onrender.com/auth/callback`
9. Click "Save"
10. Go back to Render.com and add the environment variables:
    - `SHOPIFY_API_KEY` = (Client ID from step 6)
    - `SHOPIFY_API_SECRET` = (Client Secret from step 6)
11. Render will automatically redeploy

---

## PHASE 5: Update the App Config File

**Time: 5 minutes**

1. Open the file `shopify.app.toml` in the `intimasync` folder
2. Replace `YOUR_CLIENT_ID_HERE` with your actual Client ID
3. Replace `YOUR_APP_URL.onrender.com` with your actual Render URL
4. Save the file and push to GitHub (Render will redeploy automatically)

---

## PHASE 6: Install on Dev Store

**Time: 5 minutes**

1. In Shopify Partners, click "Apps"
2. Click on "IntimaSync"
3. Click "Test on development store"
4. Select `intimasync.myshopify.com`
5. You'll be redirected to install the app on your dev store
6. Click "Install"
7. You should land on the IntimaSync dashboard!

---

## PHASE 7: Configure Suppliers

**Time: 15 minutes**

1. In IntimaSync, click "Settings" in the left nav
2. **Honey's Place:**
   - Account Number: (from your Honey's Place account)
   - API Token: (from My Account > Data Integration > API Setup)
   - Feed Token: (from your data feed URL - find in My Account > Data Integration > Data Feeds)
   - Default Shipping: Best Rate (RTSHOP)
   - Click "Save Credentials"
   - Click "Test Connection" to verify

3. **Eldorado:** (you need the static IP first)
   - In Render.com, go to your web service > "Static IP"
   - Copy your static IP address
   - Email dropship@eldorado.net with: your domain (flowandglow.org), your partnerID, and this IP
   - They will email you a key within 1-2 business days
   - Once received, enter: API Key, Account ID, SFTP Username, SFTP Password
   - Default Shipping: Best Rate 2 Day (BR2D) or UPS Ground Residential (UGR)
   - Click "Save Credentials"

4. **Nalpac:**
   - Username: (your Nalpac username)
   - Password: (your Nalpac password)
   - Default Shipping: Best Way
   - Click "Save Credentials"
   - Click "Test Connection" to verify

---

## PHASE 8: First Sync

**Time: 30-60 minutes (runs in background)**

1. From the Dashboard, click "Sync Now"
2. This will fetch product catalogs from all enabled suppliers
3. Check back in 30-60 minutes - products should appear in the Products view

---

## PHASE 9: Test Everything

1. In Products view, select a few products and click "Import to Shopify as Draft"
2. Go to your Shopify Products to confirm they were created
3. Place a test order in your dev store using those products
4. Check the IntimaSync Orders view to see the routing
5. Verify the order was submitted to the supplier

---

## PHASE 10: Install on flowandglow.org

When you're happy with testing on the dev store:

1. In Shopify Partners > Apps > IntimaSync, click "Distribution"
2. Choose "Custom app" distribution
3. Generate an install link for flowandglow.org
4. Open that link in your flowandglow.org Shopify admin
5. Install and configure supplier credentials for this store

---

## IMPORTANT NOTES

**Eldorado IP Requirement:**
Eldorado's API key is locked to a specific IP address. If your IP changes, your key will stop working. This is why you need Render's Starter plan ($7/mo) for a static IP. Email Eldorado if you ever change hosting.

**Honey's Place Data Feed:**
Your personal data feed URLs (which you provided) work as long as your Honey's Place account is active. The token in the URL is your feed-specific token.

**Test Mode:**
During development, the app uses Eldorado's test URLs and Honey's Place test order references (starting with "TEST"). Orders will NOT be processed for real. Change `NODE_ENV=production` in Render when ready to go live.

**Privacy Policy:**
The Shopify App Store requires a privacy policy URL. Create a page on rbfunited.com titled "IntimaSync Privacy Policy" and link to it in your Shopify Partners app settings.

---

## NEED HELP?

The app is designed so you never need to touch code once it's deployed. All configuration happens through the Settings screen. If something breaks:
1. Check Render.com "Logs" tab for error messages
2. Check Supabase "Table Editor" to see if data is being saved
3. The Shopify Partners "App errors" log shows webhook failures

---

*IntimaSync v1.0 | RBF United | rbfunited.com*
