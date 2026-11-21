const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'account-admin.js'), 'utf8').replace(/\r\n/g, '\n');
const storeSource = fs.readFileSync(path.join(root, 'js', 'supabase-store.js'), 'utf8').replace(/\r\n/g, '\n');
const adminCss = fs.readFileSync(path.join(root, 'css', 'admin.css'), 'utf8').replace(/\r\n/g, '\n');

function extract(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

const saveFunction = extract(source, '  async function saveProduct(event) {', '\n  async function productAction');
const editorFunction = extract(source, '  function setEditingProduct(product) {', '\n  function resetForm');

function saveHarness({
  id = '41',
  available = 'true',
  updateResult = { data: { id: 41 }, error: null },
  insertResult = { data: { id: 52 }, error: null },
  holdSave = false
} = {}) {
  const values = {
    'owner-id': id,
    'owner-available': available,
    'owner-name': 'Старинная вещь',
    'owner-price': '15000',
    'owner-category': 'Разное',
    'owner-year': '',
    'owner-description': 'Описание',
    'owner-link': '',
    'owner-seller': 'Старинная Коллекция',
    'owner-save-product': ''
  };
  const elements = new Map(Object.entries(values).map(([key, value]) => [
    key, { value, disabled: false, textContent: '' }
  ]));
  const notices = [];
  const operations = [];
  const logs = [];
  const updatePayloads = [];
  const insertPayloads = [];
  let releaseSave;
  const savePromise = holdSave
    ? new Promise(resolve => { releaseSave = resolve; })
    : Promise.resolve(id ? updateResult : insertResult);
  const window = {
    sb: {
      from(table) {
        assert.equal(table, 'products');
        return {
          update(payload) { updatePayloads.push(payload); return this; },
          insert(payload) { insertPayloads.push(payload); return this; },
          eq(column, value) {
            assert.equal(column, 'id');
            assert.equal(String(value), id);
            return this;
          },
          select(columns) { assert.match(columns, /(^|,)id(,|$)/); return this; },
          maybeSingle: async () => {
            operations.push('product-response');
            return savePromise;
          }
        };
      },
      rpc() { throw new Error('Product editor must not call stock RPCs.'); }
    },
    location: { reload() { operations.push('reload'); } }
  };
  const dialog = {
    open: true,
    close() { operations.push('dialog-close'); this.open = false; }
  };
  const context = {
    window,
    $: id => elements.get(id),
    notify: (text, type) => notices.push({ text, type }),
    productSaveInProgress: false,
    productDialog: dialog,
    processedPhotoFiles: null,
    selectedPhotoFiles: [],
    existingPhotoUrls: [],
    uploadPhotos: async () => [],
    resetForm() { operations.push('reset-form'); },
    restoreProductForm() { operations.push('restore-form'); },
    console: { error: (...args) => logs.push(args) },
    crypto: { randomUUID: () => 'new-product-id' },
    Date,
    Number
  };
  vm.runInNewContext(`${saveFunction}\nglobalThis.saveProductForTest = saveProduct;`, context);
  return {
    context, elements, notices, operations, logs, updatePayloads, insertPayloads,
    dialog, releaseSave
  };
}

test('editor reflects saved availability on each opening', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '', scrollIntoView() {} });
    return elements.get(id);
  };
  const context = {
    $: element,
    resetForm() {
      element('owner-id').value = '';
      element('owner-available').value = 'true';
    },
    renderPhotoPreview() {},
    setFormOpen() {},
    productDialog: { open: true },
    existingPhotoUrls: [],
    selectedPhotoFiles: []
  };
  vm.runInNewContext(`${editorFunction}\nglobalThis.openEditorForTest = setEditingProduct;`, context);

  const product = { id: 41, name: 'Предмет', price: '15000', available: false };
  context.openEditorForTest(product);
  assert.equal(element('owner-available').value, 'false');
  element('owner-available').value = 'true';
  context.openEditorForTest(product);
  assert.equal(element('owner-available').value, 'false');
  context.openEditorForTest({ ...product, available: true });
  assert.equal(element('owner-available').value, 'true');
});

test('catalog loading uses available and ignores legacy quantity values', async () => {
  const rows = [
    { id: 1, available: true, stock_quantity: null },
    { id: 2, available: false, stock_quantity: 50 },
    { id: 3, stock_quantity: 0 },
    { id: 4, available: null, stock_quantity: null }
  ];
  const window = {
    SUPABASE_CONFIG: { url: 'https://local.invalid', anonKey: 'public-test-key' },
    supabase: {
      createClient() {
        return {
          from(table) {
            assert.equal(table, 'products');
            return {
              select() { return this; },
              order: async () => ({ data: rows, error: null })
            };
          }
        };
      }
    }
  };
  vm.runInNewContext(storeSource, { window, console });
  const products = await window.loadRemoteProducts();

  assert.deepEqual(products.map(product => product.available), [true, false, true, true]);
  assert.ok(products.every(product => !Object.hasOwn(product, 'stock_quantity')));
});

test('client runtime contains no stock UI, parsing, or stock RPC dependency', () => {
  const runtimeFiles = ['app.js', 'pages.js', 'account-admin.js', 'supabase-store.js', 'featured-product.js']
    .map(file => fs.readFileSync(path.join(root, 'js', file), 'utf8'))
    .join('\n');
  const style = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.doesNotMatch(runtimeFiles, /stock_quantity|set_product_stock|editingStockQuantity|getStockQuantity|stockLabel/);
  assert.doesNotMatch(runtimeFiles, /Остаток не загружен|остатка товара|В наличии ·/i);
  assert.doesNotMatch(style, /product-stock/);
  assert.doesNotMatch(adminCss, /owner-stock-quantity/);
});

test('product-change history UI, CSS and client loading are removed without removing other histories', () => {
  const pages = fs.readFileSync(path.join(root, 'js', 'pages.js'), 'utf8');
  assert.doesNotMatch(source, /История изменений|product_change_history|owner-product-history|loadProductHistory/);
  assert.doesNotMatch(adminCss, /owner-product-history/);
  assert.match(pages, /viewed_ids/);
  assert.match(pages, /orderItems/);
  assert.match(pages, /favorites/);
});

test('editing persists an unavailable status before closing and reloading', async () => {
  const harness = saveHarness({ available: 'false' });
  await harness.context.saveProductForTest({ preventDefault() {} });

  assert.equal(harness.updatePayloads[0].available, false);
  assert.deepEqual(
    harness.operations.filter(step => ['product-response', 'dialog-close', 'reload'].includes(step)),
    ['product-response', 'dialog-close', 'reload']
  );
  assert.equal(harness.notices.at(-1).type, 'success');
});

test('creating a product defaults to available and does not send inventory values', async () => {
  const harness = saveHarness({ id: '' });
  await harness.context.saveProductForTest({ preventDefault() {} });

  assert.equal(harness.insertPayloads[0].available, true);
  assert.equal(Object.hasOwn(harness.insertPayloads[0], 'stock_quantity'), false);
  assert.ok(harness.operations.includes('reload'));
});

test('editing can switch a product back to available without an RPC', async () => {
  const harness = saveHarness({ available: 'true' });
  await harness.context.saveProductForTest({ preventDefault() {} });
  assert.equal(harness.updatePayloads[0].available, true);
  assert.ok(harness.operations.includes('reload'));
});

test('failed Supabase save leaves the editor open and does not report success', async () => {
  const harness = saveHarness({
    updateResult: { data: null, error: { message: 'RLS denied' }, status: 403 }
  });
  await harness.context.saveProductForTest({ preventDefault() {} });

  assert.equal(harness.dialog.open, true);
  assert.equal(harness.operations.includes('reload'), false);
  assert.equal(harness.notices.some(notice => notice.type === 'success'), false);
  assert.match(harness.notices.at(-1).text, /RLS denied/);
  assert.equal(harness.logs[0][1].status, 403);
});

test('a second submit while the first save is pending does not issue another request', async () => {
  const harness = saveHarness({ holdSave: true });
  const first = harness.context.saveProductForTest({ preventDefault() {} });
  await harness.context.saveProductForTest({ preventDefault() {} });
  assert.equal(harness.updatePayloads.length, 1);
  harness.releaseSave({ data: { id: 41 }, error: null });
  await first;
  assert.equal(harness.updatePayloads.length, 1);
});
