const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('external code and IMG.LY resource locations are pinned', () => {
  const html = read('index.html');
  const admin = read(path.join('js', 'account-admin.js'));
  const supabaseScript = html.match(/<script\b(?=[^>]*@supabase\/supabase-js)([^>]*)>/i)?.[1];
  const supabaseIntegrity = supabaseScript?.match(/\bintegrity="(sha384-[^"]+)"/i)?.[1];
  assert.match(supabaseIntegrity || '', /^sha384-[A-Za-z0-9+/]{64}$/);

  const moduleUrl = admin.match(/const backgroundRemovalModuleUrl = '([^']+)'/)?.[1];
  const moduleIntegrity = admin.match(/const backgroundRemovalModuleIntegrity = '(sha384-[^']+)'/)?.[1];
  const dataUrl = admin.match(/const backgroundRemovalDataUrl = '([^']+)'/)?.[1];
  assert.equal(moduleUrl, 'https://esm.sh/@imgly/background-removal@1.5.5/es2022/background-removal.bundle.mjs');
  assert.match(moduleIntegrity || '', /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.equal(dataUrl, 'https://staticimgly.com/@imgly/background-removal-data/1.5.5/dist/');
  assert.match(admin, /publicPath: backgroundRemovalDataUrl/);
  assert.match(html, /connect-src[^"]*https:\/\/staticimgly\.com\/@imgly\/background-removal-data\/1\.5\.5\/dist\//);
});

test('IMG.LY loader rejects modified module bytes before creating an import URL', async () => {
  const admin = read(path.join('js', 'account-admin.js'));
  const start = admin.indexOf('  async function loadVerifiedBackgroundRemovalModule() {');
  const end = admin.indexOf('\n  async function removeBackgrounds()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const declarations = admin.match(/  const backgroundRemovalModuleUrl = '[^']+';\n  const backgroundRemovalModuleIntegrity = '[^']+';/)?.[0];
  assert.ok(declarations);
  const loader = `${declarations}\n${admin.slice(start, end)}\nglobalThis.testLoader = loadVerifiedBackgroundRemovalModule;`;
  let createdBlobUrl = false;
  class TestURL extends URL {
    static createObjectURL() {
      createdBlobUrl = true;
      return 'blob:unexpected';
    }
    static revokeObjectURL() {}
  }
  const context = {
    URL: TestURL,
    Blob,
    crypto: webcrypto,
    btoa,
    fetch: async url => ({
      ok: true,
      url,
      arrayBuffer: async () => new TextEncoder().encode('tampered module').buffer
    })
  };
  vm.runInNewContext(loader, context);

  await assert.rejects(context.testLoader(), /не прошёл проверку целостности/i);
  assert.equal(createdBlobUrl, false);
});

test('profile mock persists only presentation fields', async () => {
  const handlers = {};
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: id === 'profile-display-name' ? 'Проверочный профиль' : '',
        textContent: '',
        hidden: false,
        disabled: false,
        files: [],
        classList: { toggle() {} },
        addEventListener(type, handler) { handlers[`${id}:${type}`] = handler; },
        replaceChildren() {},
        appendChild() {}
      });
    }
    return elements.get(id);
  };
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'mock@example.invalid' };
  let savedProfile;
  const profileQuery = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: { display_name: '', avatar_url: '' }, error: null }),
    upsert: async value => {
      savedProfile = value;
      return { error: null };
    }
  };
  const sb = {
    auth: {
      getSession: async () => ({ data: { session: { user } }, error: null }),
      onAuthStateChange() {}
    },
    from(table) {
      assert.equal(table, 'profiles');
      return profileQuery;
    }
  };
  const document = {
    getElementById: element,
    addEventListener(type, handler) { handlers[`document:${type}`] = handler; },
    querySelector() { return null; },
    createElement() { return { set src(value) {}, set alt(value) {}, set referrerPolicy(value) {} }; }
  };
  const context = {
    window: { sb },
    sb,
    document,
    URL: { revokeObjectURL() {} },
    console: { error() {} },
    setTimeout
  };
  vm.runInNewContext(read(path.join('js', 'profile.js')), context);
  handlers['document:DOMContentLoaded']();
  await new Promise(resolve => setImmediate(resolve));
  element('profile-display-name').value = 'Проверочный профиль';
  await handlers['profile-edit-form:submit']({ preventDefault() {} });

  assert.deepEqual(Object.keys(savedProfile).sort(), ['avatar_url', 'display_name', 'id']);
  assert.equal(savedProfile.id, user.id);
  assert.equal(savedProfile.display_name, 'Проверочный профиль');
});

test('push endpoint rejects unauthenticated and foreign-message requests', async () => {
  const source = read(path.join('supabase', 'functions', 'send-push', 'index.ts'));
  const executable = source
    .replace(/^import .+;\n/gm, '')
    .replace(/Deno\.env\.get\('([^']+)'\)!/g, "Deno.env.get('$1')")
    .replace('let recipientIds: string[] = [];', 'let recipientIds = [];')
    .replace('(x: {id:string}) => x.id', '(x) => x.id')
    .replace(/\(e as \{statusCode\?:number\}\)/g, 'e')
    .replace('(e as Error)', 'e');
  let handler;
  const authUser = { id: 'caller-user' };
  const adminClient = {
    from(table) {
      let columns = '';
      const query = {
        select(value) { columns = value; return this; },
        eq() { return this; },
        single: async () => table === 'messages'
          ? { data: { id: 'message-id', body: 'hello', sender_id: 'other-user', conversation_id: 'conversation-id' }, error: null }
          : { data: null, error: null },
        maybeSingle: async () => ({ data: { role: 'user' }, error: null }),
        then(resolve, reject) {
          return Promise.resolve({ data: columns === 'id' ? [] : [], error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  const context = {
    Deno: {
      serve(value) { handler = value; },
      env: { get: name => ({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private' })[name] }
    },
    createClient(url, key) {
      if (key === 'anon') return { auth: { getUser: async () => ({ data: { user: authUser }, error: null }) } };
      return adminClient;
    },
    webpush: { setVapidDetails() {}, sendNotification: async () => {} },
    Response
  };
  vm.runInNewContext(executable, context);

  const unauthenticated = await handler(new Request('https://local.test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: 'message-id' })
  }));
  assert.equal(unauthenticated.status, 401);

  const foreignMessage = await handler(new Request('https://local.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: 'message-id' })
  }));
  assert.equal(foreignMessage.status, 403);
});

test('SQL migrations retain role, ownership, RLS, RPC and Storage guards', () => {
  const schema = read('supabase-schema.sql');
  const profiles = read('profile-migration.sql');
  const messages = read('messages-migration.sql');
  const inventory = read('inventory-migration.sql');
  const archive = read('chat-archive-migration.sql');
  const readme = read('README.md');

  assert.match(schema, /revoke (?:insert|update) \(id, email, role,/i);
  assert.match(schema, /values \(new\.id,new\.email,'user'\)/i);
  assert.match(schema, /user_id = \(select auth\.uid\(\)\) or public\.is_admin\(\)/i);
  assert.match(schema, /bucket_id = 'product-photos' and public\.is_admin\(\)/i);
  assert.match(schema, /file_size_limit = 8388608/i);
  assert.match(profiles, /grant update \(id, display_name, avatar_url\) on public\.profiles to authenticated/i);
  assert.match(profiles, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/i);
  assert.match(profiles, /file_size_limit = 5242880/i);
  assert.match(messages, /alter table public\.messages enable row level security/i);
  assert.match(messages, /sender_id=auth\.uid\(\)/i);
  assert.match(messages, /file_size_limit\s*=\s*8388608/i);
  assert.match(messages, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/i);
  assert.match(inventory, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(inventory, /if auth\.uid\(\) is null or not public\.is_admin\(\) then/i);
  assert.match(inventory, /grant execute on function public\.create_shop_order\(jsonb, jsonb, jsonb, jsonb, uuid\) to authenticated/i);
  assert.match(inventory, /revoke all on function public\.create_shop_order\(jsonb, jsonb, jsonb, jsonb, uuid\) from public, anon, authenticated/i);
  assert.match(inventory, /grant execute on function public\.update_shop_order_status\(bigint, text, text, text\) to authenticated/i);
  assert.match(archive, /user_id = auth\.uid\(\)/i);
  assert.ok(
    readme.indexOf('supabase-schema.sql') < readme.indexOf('profile-migration.sql') &&
    readme.indexOf('profile-migration.sql') < readme.indexOf('messages-migration.sql') &&
    readme.indexOf('messages-migration.sql') < readme.indexOf('chat-archive-migration.sql') &&
    readme.indexOf('chat-archive-migration.sql') < readme.indexOf('inventory-migration.sql'),
    'README migration sequence must satisfy declared dependencies'
  );
});

test('message text is escaped before it is inserted into HTML', () => {
  const messages = read(path.join('js', 'messages.js'));
  const app = read(path.join('js', 'app.js'));
  assert.match(messages, /const esc = value => String\(value \?\? ''\)\.replace\(\/\[&<>"'\]\/g/);
  assert.match(messages, /\$\{esc\(message\.body\)\}/);
  assert.match(app, /\$\{esc\(p\.description/);
});
