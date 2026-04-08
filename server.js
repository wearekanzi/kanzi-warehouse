const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
require('dotenv').config();

// ─── PRINT HISTORY (persisted to disk) ───────────────────────────────────────
const HISTORY_FILE = path.join(__dirname, 'print_history.json');
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}
function saveHistory(h) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}
function recordPrint(orderName, type) {
  const h = loadHistory();
  if (!h[orderName]) h[orderName] = { label: 0, invoice: 0, packing: 0, lastPrinted: null };
  h[orderName][type] = (h[orderName][type] || 0) + 1;
  h[orderName].lastPrinted = new Date().toISOString();
  saveHistory(h);
  return h[orderName];
}

const { transliterate, hasArabic: isArabic } = require('./arabic_transliterate');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SHOPIFY_SHOP        = process.env.SHOPIFY_SHOP;
const SHOPIFY_CLIENT_ID   = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const ZOHO_CLIENT_ID      = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET  = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN  = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_ORG_ID         = process.env.ZOHO_ORG_ID;

const RELAY_URL           = process.env.RELAY_URL; // Mac Mini relay URL

// ─── TOKEN CACHE ─────────────────────────────────────────────────────────────
let shopifyToken = { value: null, expiresAt: 0 };
let zohoToken    = { value: null, expiresAt: 0 };

async function getShopifyToken() {
  if (shopifyToken.value && Date.now() < shopifyToken.expiresAt - 60000) {
    return shopifyToken.value;
  }
  const res = await axios.post(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/oauth/access_token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  shopifyToken.value = res.data.access_token;
  shopifyToken.expiresAt = Date.now() + (res.data.expires_in * 1000);
  return shopifyToken.value;
}

async function getZohoToken() {
  if (zohoToken.value && Date.now() < zohoToken.expiresAt - 60000) {
    return zohoToken.value;
  }
  const res = await axios.post(
    'https://accounts.zoho.com/oauth/v2/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      refresh_token: ZOHO_REFRESH_TOKEN,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  zohoToken.value = res.data.access_token;
  zohoToken.expiresAt = Date.now() + (res.data.expires_in * 1000);
  return zohoToken.value;
}

// ─── SHOPIFY GRAPHQL HELPER ───────────────────────────────────────────────────
async function shopifyGQL(query, variables = {}) {
  const token = await getShopifyToken();
  const res = await axios.post(
    `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/2025-01/graphql.json`,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
    }
  );
  return res.data;
}

// ─── API: PRINT HISTORY ──────────────────────────────────────────────────────
app.get('/api/print-history', (req, res) => {
  res.json({ success: true, history: loadHistory() });
});

// ─── API: GET UNFULFILLED ORDERS ──────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const data = await shopifyGQL(`
      {
        orders(first: 50, query: "fulfillment_status:unfulfilled status:open") {
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              note
              customer {
                firstName
                lastName
                phone
              }
              shippingAddress {
                address1
                address2
                city
                province
                zip
                country
                phone
              }
              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                    fulfillableQuantity
                    variant {
                      title
                      sku
                      image {
                        url
                      }
                      product {
                        metafield(namespace: "custom", key: "product_storage_location") {
                          value
                        }
                      }
                    }
                  }
                }
              }
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `);

    const orders = data.data.orders.edges.map(e => {
      const o = e.node;
      const addr = o.shippingAddress || {};
      const customer = o.customer || {};
      return {
        id: o.id,
        shopifyId: o.id.replace('gid://shopify/Order/', ''),
        name: o.name,
        createdAt: o.createdAt,
        status: o.displayFulfillmentStatus,
        customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        phone: addr.phone || customer.phone || '',
        address: [addr.address1, addr.address2, addr.city, addr.province, addr.country]
          .filter(Boolean).join('\n'),
        addressLine1: addr.address1 || '',
        addressLine2: addr.address2 || '',
        addressCity: [addr.city, addr.province, addr.country].filter(Boolean).join(', '),
        items: o.lineItems.edges
          .filter(li => li.node.fulfillableQuantity > 0)
          .map(li => ({
            title: li.node.title,
            variant: li.node.variant?.title !== 'Default Title' ? li.node.variant?.title : '',
            sku: li.node.variant?.sku || '',
            quantity: li.node.fulfillableQuantity,
            imageUrl: li.node.variant?.image?.url || '',
            storageLocation: li.node.variant?.product?.metafield?.value || '',
          })),
        total: `${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`,
      };
    });

    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching orders:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: PRINT LABEL ─────────────────────────────────────────────────────────
app.post('/api/print/label', async (req, res) => {
  try {
    const { orderName, customerName, address, addressLine1, addressLine2, addressCity, phone } = req.body;

    // Transliterate any Arabic text to English for ZPL compatibility
    const safeName    = transliterate(customerName || '') || '';
    const safeAddr1   = transliterate(addressLine1 || '') || '';
    const safeAddr2   = transliterate(addressLine2 || '') || '';
    const safeCity    = transliterate(addressCity || '') || '';
    const safeAddress = transliterate(address || '') || '';

    // Build ZPL for Zebra ZD420 300dpi, label size 1.77x3.14in (531x942 dots)
    const zpl = buildZPL({ orderName, customerName: safeName, address: safeAddress, addressLine1: safeAddr1, addressLine2: safeAddr2, addressCity: safeCity, phone });

    // Send to Mac Mini relay
    const relayRes = await axios.post(`${RELAY_URL}/print/label`, { zpl });
    if (relayRes.data.success) recordPrint(orderName, 'label');
    res.json(relayRes.data);
  } catch (err) {
    console.error('Label print error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: PRINT PACKING SLIP ──────────────────────────────────────────────────
app.post('/api/print/packing-slip', async (req, res) => {
  try {
    const { shopifyId, orderName, customerName, address, phone, items, total } = req.body;

    // Fetch images as base64 for each item so relay can embed them in the PDF
    const itemsWithImages = await Promise.all((items || []).map(async (item) => {
      if (!item.imageUrl) return { ...item, imageBase64: null };
      try {
        const imgRes = await axios.get(item.imageUrl, { responseType: 'arraybuffer' });
        const imageBase64 = Buffer.from(imgRes.data).toString('base64');
        const mimeType = imgRes.headers['content-type'] || 'image/jpeg';
        return { ...item, imageBase64: `data:${mimeType};base64,${imageBase64}` };
      } catch {
        return { ...item, imageBase64: null };
      }
    }));

    // Send to Mac Mini relay to generate and print packing slip
    const relayRes = await axios.post(`${RELAY_URL}/print/packing-slip`, {
      shopifyId, orderName, customerName, address, phone, items: itemsWithImages, total
    });
    if (relayRes.data.success) recordPrint(orderName, 'packing');
    res.json(relayRes.data);
  } catch (err) {
    console.error('Packing slip print error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: PRINT INVOICE (from Zoho Books) ────────────────────────────────────
app.post('/api/print/invoice', async (req, res) => {
  try {
    const { orderName } = req.body;

    // Find invoice in Zoho Books by Shopify order number (reference_number)
    const zohoAccessToken = await getZohoToken();
    const searchRes = await axios.get(
      `https://www.zohoapis.com/books/v3/invoices?organization_id=${ZOHO_ORG_ID}&reference_number=${encodeURIComponent(orderName)}`,
      { headers: { Authorization: `Zoho-oauthtoken ${zohoAccessToken}` } }
    );

    const invoices = searchRes.data.invoices;
    if (!invoices || invoices.length === 0) {
      return res.status(404).json({ success: false, error: `No Zoho invoice found for order ${orderName}` });
    }

    const invoiceId = invoices[0].invoice_id;

    // Download the invoice PDF
    const pdfRes = await axios.get(
      `https://www.zohoapis.com/books/v3/invoices/${invoiceId}?organization_id=${ZOHO_ORG_ID}&accept=pdf`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${zohoAccessToken}` },
        responseType: 'arraybuffer',
      }
    );

    const pdfBase64 = Buffer.from(pdfRes.data).toString('base64');

    // Send PDF to Mac Mini relay for printing on HP
    const relayRes = await axios.post(`${RELAY_URL}/print/invoice`, {
      pdfBase64,
      orderName,
    });
    if (relayRes.data.success) recordPrint(orderName, 'invoice');
    res.json(relayRes.data);
  } catch (err) {
    console.error('Invoice print error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: ARCHIVE ORDER ───────────────────────────────────────────────────────
app.post('/api/orders/archive', async (req, res) => {
  try {
    const { shopifyId } = req.body;
    const token = await getShopifyToken();

    await axios.post(
      `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/2025-01/orders/${shopifyId}/close.json`,
      {},
      { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
    );

    res.json({ success: true, message: `Order ${shopifyId} archived.` });
  } catch (err) {
    console.error('Archive error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ARABIC TEXT → ZPL GRF HELPER ──────────────────────────────────────────────
function hasArabic(text) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text || '');
}

function renderArabicGRF(text, width, height, fontSize) {
  try {
    const scriptPath = path.join(__dirname, 'arabic_to_zpl.py');
    const escaped = text.replace(/"/g, '\\"');
    const result = execSync(`python3 "${scriptPath}" "${escaped}" ${width} ${height} ${fontSize}`, { encoding: 'utf8', timeout: 5000 });
    return JSON.parse(result.trim());
  } catch (e) {
    console.error('Arabic render error:', e.message);
    return null;
  }
}

function buildArabicGFCmd(text, x, y, width, height, fontSize, label) {
  if (!hasArabic(text)) return null;
  const grf = renderArabicGRF(text, width, height, fontSize);
  if (!grf) return null;
  return `~DGR:${label}.GRF,${grf.total_bytes},${grf.bytes_per_row},${grf.hex}\n^FO${x},${y}^IMR:${label}.GRF^FS`;
}

// ─── ZPL BUILDER ─────────────────────────────────────────────────────────
function buildZPL({ orderName, customerName, address, addressLine1, addressLine2, addressCity, phone }) {
  // Label: 1.77in x 3.14in at 300dpi = 531 x 942 dots
  // Kanzi brand template matching the original PrintMaster design

  const LOGO_HEX = '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFF800000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF000000000000000000000000000000000007FFFF800000000000000000000000000000000007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00007FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE00000000000000000003FFFFC00000000000000000000000000000000001FFFF800000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFFC00000000000000000000000000000000001FFFF800000000000000000000000000000000003FFFFC00000000000000000000000000000000007FFFFE0000000000000000000000000000000000FFFFFF0000000000000000000000000000000003FFFFFFC000000000000000000000000000000007FFFFFFE00000000000000000000000000000000FFFFFFFF80000000000000000000000000000003FFFFFFFFC0000000000000000000000000000007FFFFFFFFE000000000000000000000000000000FFFFFFFFFF800000000000000000000000000003FFFFFFFFFFC00000000000000000000000000007FFFFFFFFFFE0000000000000000000000000000FFFFFFFFFFFF8000000000000000000000000003FFFFFFFFFFFFC000000000000000000000000007FFFFFFFFFFFFE00000000000000000000000001FFFFFFFFFFFFFF80000000000000000000000003FFFFFFFFFFFFFFC0000000000000000000000007FFFFFFFFFFFFFFE000000000000000000000001FFFFFFFFFFFFFFFF800000000000000000000003FFFFFFFFFFFFFFFFC00000000000000000000007FFFFFFFFFFFFFFFFE0000000000000000000001FFFFFFFF81FFFFFFFF8000000000000000000003FFFFFFFF00FFFFFFFFC000000000000000000007FFFFFFFC007FFFFFFFE00000000000000000001FFFFFFFF8001FFFFFFFF80000000000000000003FFFFFFFF0000FFFFFFFFC0000000000000000007FFFFFFFC00007FFFFFFFF000000000000000001FFFFFFFF800001FFFFFFFF800000000000000003FFFFFFFF000000FFFFFFFFC00000000000000007FFFFFFFC0000007FFFFFFFF0000000000000001FFFFFFFF80000001FFFFFFFF8000000000000003FFFFFFFF00000000FFFFFFFFC00000000000000FFFFFFFFC000000003FFFFFFFF00000000000001FFFFFFFF8000000001FFFFFFFF80000000000003FFFFFFFF0000000000FFFFFFFFC000000000000FFFFFFFFC00000000003FFFFFFFF000000000001FFFFFFFF800000000001FFFFFFFF800000000003FFFFFFFF000000000000FFFFFFFFC0000000000FFFFFFFFC0000000000003FFFFFFFF0000000001FFFFFFFF80000000000001FFFFFFFF8000000003FFFFFFFF00000000000000FFFFFFFFC00000000FFFFFFFFC000000000000003FFFFFFFF00000001FFFFFFFF8000000000000001FFFFFFFF80000003FFFFFFFF0000000000000000FFFFFFFFC000000FFFFFFFFC00000000000000003FFFFFFFF000001FFFFFFFF800000000000000001FFFFFFFF800003FFFFFFFF000000000000000000FFFFFFFFC00007FFFFFFFC0000000000000000003FFFFFFFE00007FFFFFFF80000000000000000001FFFFFFFE00007FFFFFFF00000000000000000000FFFFFFFE00007FFFFFFC000000000000000000003FFFFFFE00007FFFFFF8000000000000000000001FFFFFFE00007FFFFFF0000000000000000000000FFFFFFE00007FFFFFC00000000000000000000003FFFFFE00007FFFFF800000000000000000000001FFFFFE00007FFFFF000000000000000000000000FFFFFE00007FFFFC0000000000000000000000003FFFFE00007FFFF80000000000000000000000001FFFFE00007FFFF00000000000000000000000000FFFFE00007FFFC000000000000000000000000003FFFE00007FFF8000000000000000000000000001FFFE00007FFF00000000000000000000000000007FFE00007FFC00000000000000000000000000003FFE00007FF800000000000000000000000000001FFE00007FF0000000000000000000000000000007FE00007FC0000000000000000000000000000003FE00007F80000000000000000000000000000001FE00007F000000000000000000000000000000007E00007C000000000000000000000000000000003E000078000000000000000000000000000000001E00007000000000000000000000000000000000060000400000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  const LOGO_BYTES_PER_ROW = 20;
  const LOGO_TOTAL_BYTES = 3200;

  // Use structured address fields if available, otherwise fall back to splitting address string
  let line1, line2, line3, line4;
  if (addressLine1 || addressLine2 || addressCity) {
    line1 = addressLine1 || '';
    line2 = addressLine2 || '';
    line3 = addressCity || '';
    line4 = '';
  } else {
    const addrLines = splitText(address || '', 30);
    line1 = addrLines[0] || '';
    line2 = addrLines[1] || '';
    line3 = addrLines[2] || '';
    line4 = addrLines[3] || '';
  }

  // Clean order number for barcode (remove # prefix)
  const orderNum = orderName.replace('#', '');

  // All text is already transliterated to ASCII before reaching here
  const nameCmd  = `^FO8,372^A0N,28,28^FD${customerName}^FS`;
  const addrCmd1 = line1 ? `^FO8,410^A0N,24,24^FD${line1}^FS` : '';
  const addrCmd2 = line2 ? `^FO8,438^A0N,24,24^FD${line2}^FS` : '';
  const addrCmd3 = line3 ? `^FO8,466^A0N,24,24^FD${line3}^FS` : '';
  const addrCmd4 = line4 ? `^FO8,494^A0N,24,24^FD${line4}^FS` : '';

  // Label 531 x 945 dots (1.77 x 3.14in at 300dpi)
  return `^XA
^PW531
^LL945
^CI28

~DGR:LOGO.GRF,${LOGO_TOTAL_BYTES},${LOGO_BYTES_PER_ROW},${LOGO_HEX}

^FO8,68^IMR:LOGO.GRF^FS

^FO265,68^A0N,20,20^FDWWW.SHOPKANZI.COM^FS
^FO265,92^BY2,2,55^BEN,55,N,N^FD${orderNum}^FS

^FO8,250^GB515,4,4^FS
^FO0,263^A0N,44,44^FB531,1,,C^FDORDER ${orderName}^FS
^FO8,318^GB515,4,4^FS

^FO8,338^A0N,26,26^FDSHIP TO:^FS
${nameCmd}
${addrCmd1}
${addrCmd2}
${addrCmd3}
${addrCmd4}
^FO8,532^A0N,26,26^FD${phone}^FS

^FO8,870^A0N,22,22^FDCan't wait to see kanzi on you^FS
^FO355,750^BQN,2,5^FDQA,https://shopkanzi.com^FS

^XZ`;
}

function splitText(text, maxLen) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxLen) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cloud app running on port ${PORT}`));
