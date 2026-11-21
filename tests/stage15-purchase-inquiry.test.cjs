const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const requestResult = () => ({
  id: 123,
  request_number: 'MDA-2026-000123',
  conversation_id: '00000000-0000-4000-8000-000000000123',
  items: [{
    product_id: 42,
    name: 'Антикварная ваза',
    image: 'https://images.example.com/vase.jpg',
    photos: ['https://images.example.com/vase-detail.jpg'],
    price: '125 000 ₽',
    unit_price: 125000,
    quantity: 1,
    line_total: 125000
  }],
  total: 125000,
  created_at: '2026-11-21T00:00:00Z'
});

function clientSubmitHarness(rpc) {
  const pages = read(path.join('js', 'pages.js'));
  const patternStart = pages.indexOf('    const purchaseRequestIdPattern =');
  const patternEnd = pages.indexOf('\n', patternStart);
  const idStart = pages.indexOf('    function getPurchaseRequestId(', patternEnd);
  const clearStart = pages.indexOf('    function clearPurchaseRequestId(', idStart);
  const openStart = pages.indexOf('    async function openPurchaseInquiry(', clearStart);
  const submitStart = pages.indexOf('    async function submitPurchaseRequest(', openStart);
  const submitEnd = pages.indexOf("\n    $('c-request-purchase')", submitStart);
  const values = {
    'purchase-inquiry-form': {
      hidden: false,
      setAttribute() {},
      removeAttribute() {},
      reset() {}
    },
    'inquiry-submit': { disabled: false, textContent: 'Подтвердить заявку' },
    'inquiry-close': { disabled: false },
    'inquiry-success': { hidden: true },
    'inquiry-success-number': { textContent: '' },
    'inquiry-open-order': { hidden: true },
    'inquiry-discuss-order': { hidden: true },
    'inquiry-success-close': { focus() {} },
    'inquiry-status': { textContent: '', className: '', hidden: true }
  };
  const calls = [];
  const cleared = [];
  const sessionValues = new Map();
  let uuidCounter = 1;
  const context = {
    purchaseRequestSending: false,
    createdPurchaseRequest: null,
    closingInquiry: false,
    window: {
      sb: {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'buyer-uuid' } } }, error: null })
        },
        rpc: async (...args) => {
          calls.push(args);
          return rpc(...args);
        }
      },
      crypto: {
        randomUUID: () => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}`
      },
      storeToast() {},
      setTimeout
    },
    localStorage: {
      getItem: key => sessionValues.get(key) || null,
      setItem: (key, value) => sessionValues.set(key, value),
      removeItem: key => sessionValues.delete(key)
    },
    $: id => values[id],
    renderInquiryComposition: () => ({
      currentLines: [
        { p: { id: 42, name: 'Ваза', price: '125 000 ₽', available: true }, q: 1 },
        { p: { id: 43, name: 'Сервиз', price: '20 000 ₽', available: true }, q: 2 }
      ],
      subtotal: 165000
    }),
    clearCart: () => cleared.push(true),
    setInquiryStatus(message, type = '') {
      values['inquiry-status'].textContent = message;
      values['inquiry-status'].className = type;
      values['inquiry-status'].hidden = !message;
    },
    console: { error() {}, warn() {} }
  };
  assert.ok(patternStart >= 0 && patternEnd > patternStart);
  assert.ok(idStart >= 0 && clearStart > idStart && openStart > clearStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  const idHelper = pages.slice(idStart, openStart);
  const submit = pages.slice(submitStart, submitEnd);
  vm.runInNewContext(
    `${pages.slice(patternStart, patternEnd)}\n${idHelper}\n${submit}\n` +
      'this.submit = submitPurchaseRequest; this.getRequestId = getPurchaseRequestId;',
    context
  );
  return { context, values, calls, cleared, sessionValues };
}

test('purchase request RPC receives only product IDs and quantities', async () => {
  const harness = clientSubmitHarness(async () => ({ data: requestResult(), error: null }));
  await harness.context.submit({ preventDefault() {} });
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0][0], 'create_purchase_request');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls[0][1].p_items)), [
    { product_id: 42, quantity: 1 },
    { product_id: 43, quantity: 2 }
  ]);
  assert.equal(harness.calls[0][1].p_idempotency_key, '00000000-0000-4000-8000-000000000001');
  assert.equal(harness.cleared.length, 1);
  assert.equal(harness.values['inquiry-success'].hidden, false);
  assert.equal(harness.values['inquiry-success-number'].textContent, 'MDA-2026-000123');
  assert.equal(harness.values['purchase-inquiry-form'].hidden, true);
});

test('client blocks a second submit while the first RPC is pending', async () => {
  let resolveRpc;
  const harness = clientSubmitHarness(() => new Promise(resolve => { resolveRpc = resolve; }));
  const first = harness.context.submit({ preventDefault() {} });
  const duplicate = harness.context.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.values['inquiry-submit'].disabled, true);
  assert.equal(harness.cleared.length, 0);
  resolveRpc({ data: requestResult(), error: null });
  await Promise.all([first, duplicate]);
  assert.equal(harness.cleared.length, 1);
});

test('network failure leaves cart intact and retry reuses the idempotency key', async () => {
  let fail = true;
  const harness = clientSubmitHarness(async () => {
    if (fail) return { data: null, error: new Error('network timeout') };
    return { data: requestResult(), error: null };
  });
  await harness.context.submit({ preventDefault() {} });
  const firstKey = harness.calls[0][1].p_idempotency_key;
  assert.equal(harness.cleared.length, 0);
  assert.equal(harness.values['purchase-inquiry-form'].hidden, false);
  assert.equal(harness.sessionValues.size, 1);

  fail = false;
  await harness.context.submit({ preventDefault() {} });
  assert.equal(harness.calls[1][1].p_idempotency_key, firstKey);
  assert.equal(harness.cleared.length, 1);
  assert.equal(harness.sessionValues.size, 0);
});

test('idempotency keys are stable for the same cart and rotate when its contents change', () => {
  const harness = clientSubmitHarness(async () => ({ data: requestResult(), error: null }));
  const items = [{ product_id: 42, quantity: 1 }];
  const first = harness.context.getRequestId('buyer-uuid', items);
  const retry = harness.context.getRequestId('buyer-uuid', items);
  const changed = harness.context.getRequestId('buyer-uuid', [{ product_id: 42, quantity: 2 }]);
  assert.equal(first, retry);
  assert.notEqual(changed, first);
});

test('order list uses only authenticated Supabase orders and snapshot fields', () => {
  const pages = read(path.join('js', 'pages.js'));
  const start = pages.indexOf('async function renderLk()');
  const itemsStart = pages.indexOf('const renderOrderItems = order =>', start);
  const itemsEnd = pages.indexOf('const orderEmptyState =', itemsStart);
  const renderOrders = pages.slice(start, itemsStart);
  const renderSnapshotItems = pages.slice(itemsStart, itemsEnd);
  assert.match(renderOrders, /let orders = \[\]/);
  assert.match(renderOrders, /sb\.from\('orders'\)\.select\('\*'\)/);
  assert.doesNotMatch(renderOrders, /getList\('orders'\)/);
  assert.doesNotMatch(renderSnapshotItems, /products\.find|byAvito/);
  assert.match(renderSnapshotItems, /item\.image/);
  assert.match(renderSnapshotItems, /item\.unit_price/);
  assert.match(renderSnapshotItems, /item\.line_total/);
  assert.match(pages.slice(itemsEnd), /openShopChatConversation/);
  assert.match(renderOrders, /Локальная копия не отображается/);
});

test('unauthenticated cart request prompts for login without clearing persisted cart', async () => {
  const pages = read(path.join('js', 'pages.js'));
  const start = pages.indexOf('async function openPurchaseInquiry()');
  const end = pages.indexOf('\n    function closePurchaseInquiry()', start);
  const clicked = [];
  let clearCount = 0;
  const dialog = { classList: { remove() {} }, showModal() { throw new Error('Must not open before login'); } };
  const form = { reset() {}, hidden: false };
  const values = {
    'purchase-inquiry-dialog': dialog,
    'purchase-inquiry-form': form,
    'inquiry-success': { hidden: true },
    'inquiry-close': { hidden: false },
    'inquiry-submit': { disabled: false },
    'auth-open': { click() { clicked.push(true); } }
  };
  const context = {
    window: {
      sb: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
      storeToast() {}
    },
    lines: () => [{ p: { available: true }, q: 1 }],
    $: id => values[id],
    clearCart: () => { clearCount += 1; },
    console: { error() {} }
  };
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(`${pages.slice(start, end)}\nthis.open = openPurchaseInquiry;`, context);
  await context.open();
  assert.equal(clicked.length, 1);
  assert.equal(form.hidden, false);
  assert.equal(clearCount, 0);
});

test('migration secures atomic, idempotent request creation and never uses stock', () => {
  const migration = read('purchase-request-migration.sql');
  assert.match(migration, /create or replace function public\.create_purchase_request\s*\(\s*p_items jsonb,\s*p_idempotency_key uuid/s);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /public\.is_admin\(\)/);
  assert.match(migration, /grant execute on function public\.create_purchase_request\(jsonb, uuid\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.create_purchase_request\(jsonb, uuid\) from public, anon, authenticated/i);
  assert.match(migration, /product\.available is true/i);
  assert.match(migration, /if v_valid_count <> v_item_count then/i);
  assert.match(migration, /purchase_request_price_amount\(product\.price\)/i);
  assert.match(migration, /sum\(price\.amount \* line\.quantity\)/i);
  assert.match(migration, /'line_total', price\.amount \* line\.quantity/i);
  assert.match(migration, /orders_user_idempotency_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /purchase_request_id/);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(migration, /stock_quantity|set_product_stock|create_shop_order/i);
});

test('request RPC links one system message and a reusable conversation to each order', () => {
  const migration = read('purchase-request-migration.sql');
  assert.match(migration, /conversation\.customer_id = v_user_id[\s\S]*order by conversation\.last_message_at desc/);
  assert.match(migration, /insert into public\.messages[\s\S]*'purchase_request', v_order_id/);
  assert.match(migration, /create unique index if not exists messages_purchase_request_uidx/);
  assert.match(migration, /conversation_id uuid references public\.conversations/);
  assert.match(migration, /request_number := format\([\s\S]*MDA-/);
  assert.match(migration, /lpad\(v_order_id::text, greatest\(6, char_length\(v_order_id::text\)\), '0'\)/);
  assert.match(migration, /create policy "Customers read own orders"[\s\S]*user_id = \(select auth\.uid\(\)\) or public\.is_admin\(\)/);
  assert.match(migration, /drop policy if exists "Customers create own orders" on public\.orders/i);
  assert.match(migration, /revoke all on public\.orders from public, anon, authenticated/i);
});

test('chat renders linked request snapshots and can open a specific RLS-protected conversation', () => {
  const messages = read(path.join('js', 'messages.js'));
  assert.match(messages, /purchaseRequestMarkup\(request\)/);
  assert.match(messages, /select\('id,request_number,items,total,created_at'\)/);
  assert.match(messages, /window\.openShopChatConversation = async conversationId/);
  assert.match(messages, /\.eq\('id', conversationId\)\s*\.maybeSingle\(\)/);
  assert.match(messages, /conversation_user_hides/);
  assert.match(messages, /esc\(item\.name \|\| 'Товар'\)/);
});

test('admin shows inquiry snapshots and chat link without exposing admin tools to users', () => {
  const admin = read(path.join('js', 'account-admin.js'));
  assert.match(admin, /profile\?\.role !== 'admin'/);
  assert.match(admin, /order\.request_number/);
  assert.match(admin, /productPhoto\(item\)/);
  assert.match(admin, /item\.line_total/);
  assert.match(admin, /openShopChatConversation\('\$\{esc\(order\.conversation_id\)\}'\)/);
  assert.match(admin, /Без заявок на приобретение/);
});

test('client no longer uses email, Resend, Turnstile or checkout RPC paths', () => {
  const pages = read(path.join('js', 'pages.js'));
  const html = read('index.html');
  const config = read(path.join('js', 'config.js'));
  assert.match(html, /id="c-request-purchase"[^>]*>Оформить заявку/);
  assert.match(pages, /rpc\('create_purchase_request'/);
  assert.doesNotMatch(`${pages}\n${html}\n${config}`, /send-inquiry|turnstile|RESEND_API_KEY|captchaToken|create_shop_order/i);
  assert.doesNotMatch(html, /inquiry-phone|inquiry-email|inquiry-captcha/);
});
