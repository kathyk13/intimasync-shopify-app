/**
 * IntimaSync - Privacy Policy (public, no auth required)
 * Accessible at /privacy for Shopify App Store compliance
 */

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: "720px", margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, -apple-system, sans-serif", color: "#333", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>IntimaSync Privacy Policy</h1>
      <p style={{ color: "#666", marginBottom: "32px" }}>Last updated: April 10, 2026</p>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>1. Introduction</h2>
        <p>
          IntimaSync ("we", "our", "us") is a Shopify app that helps merchants automate
          dropshipping operations by connecting their Shopify store with third-party
          suppliers. This privacy policy explains what data we collect, how we use it,
          and your rights regarding that data.
        </p>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>2. Data We Collect</h2>
        <p>When you install and use IntimaSync, we access and store the following data from your Shopify store:</p>
        <ul style={{ paddingLeft: "24px", marginTop: "8px" }}>
          <li><strong>Store information:</strong> Your Shopify domain and store name, used to identify your account.</li>
          <li><strong>Product data:</strong> Product titles, SKUs, barcodes (UPCs), variant information, and pricing from your Shopify catalog and connected supplier catalogs.</li>
          <li><strong>Order data:</strong> Order IDs, order numbers, line item details, and shipping addresses from orders placed in your store. This data is used to route orders to the correct supplier for fulfillment.</li>
          <li><strong>Supplier credentials:</strong> API keys, usernames, and passwords you provide to connect to your supplier accounts. These are stored encrypted in our database.</li>
          <li><strong>Inventory data:</strong> Stock levels and availability from your connected suppliers, used to keep your Shopify inventory accurate.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>3. How We Use Your Data</h2>
        <p>We use the data described above exclusively to provide the IntimaSync service:</p>
        <ul style={{ paddingLeft: "24px", marginTop: "8px" }}>
          <li>Syncing product catalogs between your Shopify store and connected suppliers</li>
          <li>Routing incoming orders to the appropriate supplier based on price, availability, and your fulfillment preferences</li>
          <li>Updating inventory levels in your Shopify store to reflect real-time supplier stock</li>
          <li>Submitting orders to suppliers on your behalf for dropship fulfillment</li>
          <li>Displaying order status, tracking information, and sync logs within the app</li>
        </ul>
        <p style={{ marginTop: "8px" }}>
          We do not sell, rent, or share your data with any third parties other than the
          suppliers you have explicitly connected through the app.
        </p>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>4. Data Storage and Security</h2>
        <p>
          Your data is stored in a PostgreSQL database hosted by Supabase with encryption
          at rest and in transit. Supplier credentials are stored in encrypted form.
          Our application is hosted on Render with HTTPS enforced for all connections.
        </p>
        <p style={{ marginTop: "8px" }}>
          We retain your data for as long as you have IntimaSync installed. When you
          uninstall the app, we delete your store data, supplier credentials, and order
          routing records within 30 days.
        </p>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>5. Customer Data</h2>
        <p>
          IntimaSync processes customer shipping addresses from Shopify orders solely
          to submit them to your connected suppliers for order fulfillment. We do not
          use customer data for marketing, analytics, or any purpose other than completing
          the dropship fulfillment you have configured.
        </p>
        <p style={{ marginTop: "8px" }}>
          We comply with Shopify's mandatory GDPR webhooks. When a customer or store
          requests data deletion, we remove all associated records from our system.
        </p>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>6. Third-Party Services</h2>
        <p>IntimaSync connects to the following third-party services on your behalf:</p>
        <ul style={{ paddingLeft: "24px", marginTop: "8px" }}>
          <li><strong>Supplier APIs:</strong> Honey's Place, Eldorado, and Nalpac (and any future suppliers we add). Data is sent to these suppliers only when you have configured and enabled a connection.</li>
          <li><strong>Supabase:</strong> Database hosting provider.</li>
          <li><strong>Render:</strong> Application hosting provider.</li>
        </ul>
        <p style={{ marginTop: "8px" }}>
          Each of these services has its own privacy policy. We encourage you to review
          them independently.
        </p>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>7. Your Rights</h2>
        <p>You have the right to:</p>
        <ul style={{ paddingLeft: "24px", marginTop: "8px" }}>
          <li>Request a copy of all data we store about your shop</li>
          <li>Request deletion of your data at any time by uninstalling the app or contacting us</li>
          <li>Update or correct your supplier credentials through the Settings page</li>
        </ul>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>8. Changes to This Policy</h2>
        <p>
          We may update this privacy policy from time to time. When we do, we will update
          the "Last updated" date at the top of this page. Continued use of IntimaSync
          after changes constitutes acceptance of the updated policy.
        </p>
      </section>

      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "8px" }}>9. Contact Us</h2>
        <p>
          If you have questions about this privacy policy or your data, contact us at{" "}
          <a href="mailto:support@intimasync.com" style={{ color: "#2c6ecb" }}>support@intimasync.com</a>.
        </p>
      </section>

      <footer style={{ borderTop: "1px solid #ddd", paddingTop: "16px", color: "#888", fontSize: "14px" }}>
        <p>IntimaSync is operated by FLOW+GLOW LLC.</p>
      </footer>
    </div>
  );
}
