const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function priceParser() {
  const window = {};
  vm.runInNewContext(read(path.join('js', 'price-utils.js')), { window });
  return window.parseProductPrice;
}

function storeFor(product, initialCart = []) {
  const memory = new Map([['cart', JSON.stringify(initialCart)]]);
  const window = { CATALOG: [product], parseProductPrice: priceParser(), addEventListener() {} };
  const document = {
    addEventListener() {},
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() { return { remove() {} }; },
    body: { appendChild() {} }
  };
  vm.runInNewContext(read(path.join('js', 'app.js')), {
    window,
    document,
    localStorage: {
      getItem(key) { return memory.get(key) || null; },
      setItem(key, value) { memory.set(key, value); }
    },
    setTimeout() {},
    Event
  });
  return { window, memory };
}

test('available status, not legacy quantity, controls adding to cart', () => {
  const available = storeFor({ id: 1, price: '15000', available: true, stock_quantity: null });
  assert.equal(available.window.canAddToCart(available.window.products[0]), true);
  available.window.addToCart(1);
  available.window.addToCart(1);
  assert.equal(JSON.parse(available.memory.get('cart'))[0].quantity, 2);

  const unavailable = storeFor({ id: 2, price: '15000', available: false, stock_quantity: 100 });
  assert.equal(unavailable.window.canAddToCart(unavailable.window.products[0]), false);
  unavailable.window.addToCart(2);
  assert.equal(JSON.parse(unavailable.memory.get('cart')).length, 0);
});

test('parses an ungrouped integer price', () => {
  assert.equal(priceParser()('15000'), 15000);
});

test('parses a space-grouped integer price', () => {
  assert.equal(priceParser()('15 000 ₽'), 15000);
});

test('parses decimal prices with a dot or comma', () => {
  const parse = priceParser();
  assert.equal(parse('15000.75'), 15000.75);
  assert.equal(parse('15 000,50 ₽'), 15000.5);
});

test('treats a request-price label as non-purchasable, not zero', () => {
  const parse = priceParser();
  assert.equal(parse('Цена по запросу'), null);
  assert.equal(parse('0'), null);
  const store = storeFor({ id: 1, price: 'Цена по запросу', available: true }).window;
  assert.equal(store.canAddToCart(store.products[0]), false);
});

test('cart and inquiry flow rely on availability rather than stock quantities', () => {
  const pages = read(path.join('js', 'pages.js'));
  assert.match(pages, /if \(l\.p\.available === false\)/);
  assert.match(pages, /p\.available === false/);
  assert.doesNotMatch(pages, /getStockQuantity|stockLabel|stock_quantity|остаток|create_shop_order|placeOrder/i);
});

test('cart quantity changes are unbounded by legacy stock but blocked for unavailable products', () => {
  const pages = read(path.join('js', 'pages.js'));
  const cartHelpers = pages.slice(
    pages.indexOf('function lines() {'),
    pages.indexOf('window.cartQty = function (avitoId, d) {')
  );
  const cartQty = pages.slice(
    pages.indexOf('window.cartQty = function (avitoId, d) {'),
    pages.indexOf('window.clearCart = function () {')
  );
  const product = { id: 1, avitoId: 'item-1', available: true };
  let cart = [{ ...product, quantity: 3, stock_quantity: 3 }];
  const notices = [];
  const window = { storeToast: message => notices.push(message) };
  const context = {
    window,
    products: [product],
    getCart: () => cart,
    byAvito: value => product.avitoId === String(value) ? product : null,
    saveCart: value => { cart = value; },
    updateCartCount() {},
    renderCart() {}
  };
  vm.runInNewContext(`${cartHelpers}\n${cartQty}`, context);

  window.cartQty('item-1', 1);
  assert.equal(cart[0].quantity, 4);
  product.available = false;
  window.cartQty('item-1', 1);
  assert.equal(cart[0].quantity, 4);
  assert.match(notices[0], /Нет в наличии/);
});

test('products grants still restrict writes to authenticated RLS users', () => {
  const schema = read('supabase-schema.sql');
  assert.match(schema, /revoke all on public\.products from public, anon, authenticated/i);
  assert.match(schema, /grant select on public\.products to anon, authenticated/i);
  assert.match(schema, /grant insert, update, delete on public\.products to authenticated/i);
  assert.doesNotMatch(schema, /grant (?:insert|update|delete|all).*public\.products.*to anon/i);
});
