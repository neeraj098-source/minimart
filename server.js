const express = require("express");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const port = process.env.PORT || 3001;
const gatewayApiUrl = (process.env.GATEWAY_API_URL || "http://localhost:3000").replace(/\/+$/, "");
const merchantKeyId = process.env.MERCHANT_KEY_ID;
const merchantKeySecret = process.env.MERCHANT_KEY_SECRET;
const gatewayWebhookSecret = process.env.GATEWAY_WEBHOOK_SECRET;
const gatewayConfigured = Boolean(merchantKeyId && merchantKeySecret);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/webhook", express.raw({ type: "*/*" }));
app.use(express.static(path.join(__dirname, "public")));

const products = [
  {
    id: 1,
    name: "Classic Tee",
    price: 799,
    image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80",
    description: "Soft cotton premium everyday tee",
  },
  {
    id: 2,
    name: "Urban Backpack",
    price: 1499,
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
    description: "Water-resistant everyday carry bag",
  },
  {
    id: 3,
    name: "Wireless Earbuds",
    price: 2499,
    image: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=900&q=80",
    description: "Noise-isolating earbuds with great battery",
  },
];

function buildGatewayAuthHeader() {
  return "Basic " + Buffer.from(`${merchantKeyId}:${merchantKeySecret}`).toString("base64");
}

app.get("/api/products", (req, res) => {
  res.json(products);
});

app.post("/api/create-order", async (req, res) => {
  try {
    if (!gatewayConfigured) {
      return res.status(400).json({
        message: "Merchant gateway credentials are missing. Add MERCHANT_KEY_ID and MERCHANT_KEY_SECRET in .env.",
      });
    }

    const { cart } = req.body;

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Cart is empty." });
    }

    let total = 0;
    const cartItems = [];

    for (const item of cart) {
      const product = products.find((p) => p.id === Number(item.id));
      if (!product) {
        return res.status(400).json({ message: "Invalid product in cart." });
      }
      const quantity = Number(item.quantity || 1);
      total += product.price * quantity;
      cartItems.push({ product_id: product.id, quantity });
    }

    const gatewayResponse = await fetch(`${gatewayApiUrl}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: buildGatewayAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: total * 100,
        currency: "INR",
        receipt: `rcpt_${Date.now()}`,
        notes: {
          callback_url: "http://localhost:3001",
          redirect_url: "http://localhost:3001",
          cart_items_count: cartItems.length,
        },
      }),
    });

    const order = await gatewayResponse.json().catch(() => ({}));

    if (!gatewayResponse.ok) {
      return res.status(gatewayResponse.status || 500).json({
        message: order.message || order.error || "Gateway order creation failed.",
        details: order,
      });
    }

    res.json({
      id: order.id || order.order_id,
      order_id: order.id || order.order_id,
      checkout_url: (order.checkout_url && order.checkout_url.startsWith('/') ? `${gatewayApiUrl}${order.checkout_url}` : (order.checkout_url || order.payment_url || null)),
      amount: order.amount || total * 100,
      currency: order.currency || "INR",
      gateway: "merchant",
    });
  } catch (error) {
    console.error("Error creating gateway order:", error);
    res.status(502).json({
      message: "Gateway server unreachable. Check GATEWAY_API_URL and make sure your merchant server is running.",
    });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id,
      payment_id,
      signature,
    } = req.body;

    const orderId = razorpay_order_id || order_id;
    const paymentId = razorpay_payment_id || payment_id;
    const incomingSignature = razorpay_signature || signature;

    if (!orderId || !paymentId || !incomingSignature) {
      return res.status(400).json({ message: "Missing payment verification data." });
    }

    const expectedSignature = crypto
      .createHmac("sha256", merchantKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const isAuthentic = crypto.timingSafeEqual(
      Buffer.from(incomingSignature),
      Buffer.from(expectedSignature)
    );

    if (!isAuthentic) {
      return res.status(400).json({ success: false, error: "TAMPERED_SIGNATURE" });
    }

    res.json({ success: true, message: "Payment verified successfully" });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ message: "Unable to verify payment." });
  }
});

app.post("/api/webhook", (req, res) => {
  const signature = req.headers["x-gateway-signature"] || req.headers["x-razorpay-signature"];
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body || {});

  if (!gatewayWebhookSecret || !signature) {
    return res.status(401).send("Invalid signature");
  }

  const expectedSignature = crypto
    .createHmac("sha256", gatewayWebhookSecret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expectedSignature) {
    return res.status(401).send("Invalid signature");
  }

  let eventBody = {};
  try {
    eventBody = JSON.parse(rawBody);
  } catch (error) {
    return res.status(400).send("Invalid webhook payload");
  }

  const event = eventBody.event;
  if (event === "order.paid") {
    const payment = eventBody.payload && eventBody.payload.payment && eventBody.payload.payment.entity;
    if (payment) {
      console.log("Order paid:", payment.order_id, payment.id);
    }
  }

  res.status(200).send({ received: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Store app running on http://localhost:${port}`);
  console.log(`Gateway API URL: ${gatewayApiUrl}`);
});
