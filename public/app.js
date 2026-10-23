const productGrid = document.getElementById('productGrid');
const cartItems = document.getElementById('cartItems');
const cartCount = document.getElementById('cartCount');
const cartTotal = document.getElementById('cartTotal');
const checkoutForm = document.getElementById('checkoutForm');
const paymentStatus = document.getElementById('paymentStatus');
const paymentStatusTitle = document.getElementById('paymentStatusTitle');
const paymentStatusText = document.getElementById('paymentStatusText');

let products = [];
let cart = [];

function showPaymentStatus(type, title, text) {
  paymentStatus.classList.remove('hidden', 'success', 'error', 'pending');
  paymentStatus.classList.add(type);
  paymentStatusTitle.textContent = title;
  paymentStatusText.textContent = text;
}

function hidePaymentStatus() {
  paymentStatus.classList.add('hidden');
  paymentStatus.classList.remove('success', 'error', 'pending');
}

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function saveCart() {
  localStorage.setItem('miniMartCart', JSON.stringify(cart));
}

function loadCart() {
  const saved = localStorage.getItem('miniMartCart');
  if (saved) {
    cart = JSON.parse(saved);
  }
}

function getProductById(id) {
  return products.find((item) => item.id === Number(id));
}

function addToCart(productId) {
  const existing = cart.find((item) => item.id === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ id: productId, quantity: 1 });
  }
  saveCart();
  renderCart();
}

function updateQty(productId, delta) {
  const item = cart.find((entry) => entry.id === productId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter((entry) => entry.id !== productId);
  }
  saveCart();
  renderCart();
}

function getCartTotal() {
  return cart.reduce((sum, item) => {
    const product = getProductById(item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
}

function renderProducts() {
  productGrid.innerHTML = products
    .map(
      (product) => `
        <article class="product-card">
          <img src="${product.image}" alt="${product.name}" />
          <div class="product-info">
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <div class="product-meta">
              <span class="product-price">${money(product.price)}</span>
              <button class="add-btn" data-id="${product.id}">Add to cart</button>
            </div>
          </div>
        </article>
      `
    )
    .join('');

  document.querySelectorAll('.add-btn').forEach((button) => {
    button.addEventListener('click', () => addToCart(Number(button.dataset.id)));
  });
}

function renderCart() {
  if (!cart.length) {
    cartItems.innerHTML = '<div class="empty-cart">Your cart is empty.</div>';
    cartCount.textContent = '0';
    cartTotal.textContent = money(0);
    return;
  }

  cartItems.innerHTML = cart
    .map((item) => {
      const product = getProductById(item.id);
      if (!product) return '';

      return `
        <div class="cart-item">
          <div class="cart-item-details">
            <strong>${product.name}</strong>
            <span>${money(product.price)} each</span>
            <div class="qty-controls">
              <button type="button" data-action="decrease" data-id="${product.id}">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-action="increase" data-id="${product.id}">+</button>
            </div>
          </div>
          <strong>${money(product.price * item.quantity)}</strong>
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      const action = button.dataset.action;
      updateQty(id, action === 'increase' ? 1 : -1);
    });
  });

  cartCount.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartTotal.textContent = money(getCartTotal());
}

async function createPaymentOrder() {
  const response = await fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Unable to start payment');
  }

  return data;
}

async function verifyPayment(paymentData) {
  const response = await fetch('/api/verify-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentData),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Payment verification failed');
  }

  return data;
}

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!cart.length) {
    showPaymentStatus('error', 'Cart is empty', 'Add at least one product before checkout.');
    return;
  }

  try {
    const customer = {
      name: document.getElementById('customerName').value.trim(),
      email: document.getElementById('customerEmail').value.trim(),
      phone: document.getElementById('customerPhone').value.trim(),
      address: document.getElementById('customerAddress').value.trim(),
    };

    showPaymentStatus('pending', 'Processing payment', 'Creating payment request and redirecting to the gateway.');

    const orderData = await createPaymentOrder();

    if (orderData.checkout_url) {
      const redirectUrl = `/payment-redirect.html?checkout=${encodeURIComponent(orderData.checkout_url)}`;
      const gatewayWindow = window.open(redirectUrl, '_blank', 'noopener,noreferrer');
      if (!gatewayWindow) {
        window.location.href = redirectUrl;
      }
      return;
    }

    showPaymentStatus('error', 'Gateway not ready', 'The payment portal did not return a secure checkout link.');
  } catch (error) {
    showPaymentStatus('error', 'Payment failed', error.message || 'Something went wrong during checkout.');
  }
});

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatusParam = params.get('payment');

  if (paymentStatusParam === 'success') {
    showPaymentStatus('success', 'Payment confirmed', 'Your order has been placed successfully. You can continue shopping.');
    cart = [];
    saveCart();
    renderCart();
    checkoutForm.reset();
    return;
  }

  hidePaymentStatus();
}

async function init() {
  try {
    const response = await fetch('/api/products');
    products = await response.json();
    loadCart();
    renderProducts();
    renderCart();
    handlePaymentReturn();
  } catch (error) {
    console.error('Failed to load products:', error);
  }
}

init();
