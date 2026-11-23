import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

const MAX_ITEMS = 100;
const MIN_ITEMS = 1;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true };
}

function validateEmail(value: string): boolean {
  try {
    const url = new URL(`mailto:${value}`);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  } catch {
    return false;
  }
}

function validatePhone(value: string): boolean {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function sanitizeString(value: unknown, maxLength = 1000): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  try {
    const authorization = req.headers.get('Authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const rateKey = req.headers.get('x-forwarded-for') || 'unknown';
    const rate = checkRateLimit(rateKey);
    if (!rate.allowed) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
        status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': String(rate.retryAfter || 60) }
      });
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const { data: authData, error: authError } = await createClient(url, anonKey)
      .auth.getUser(bearer);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { messageId, items, customer, conversation_id, subject, note } = body || {};

    if (conversation_id && typeof conversation_id !== 'string') {
      throw new Error('conversation_id must be a string');
    }
    if (subject && typeof subject !== 'string') {
      throw new Error('subject must be a string');
    }
    if (note && typeof note !== 'string') {
      throw new Error('note must be a string');
    }

    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, key);

    let targetConversationId: string | null = conversation_id || null;

    if (!targetConversationId && messageId) {
      const { data: msg, error: me } = await admin.from('messages').select('id,conversation_id').eq('id', messageId).single();
      if (me || !msg) throw me || new Error('Message not found');
      targetConversationId = msg.conversation_id;
    }

    if (targetConversationId) {
      const { data: conv, error: ce } = await admin.from('conversations').select('id,customer_id,product_name,subject').eq('id', targetConversationId).single();
      if (ce || !conv) throw ce || new Error('Conversation not found');
      if (conv.customer_id !== authData.user.id) {
        const { data: profile } = await admin.from('profiles').select('role').eq('id', authData.user.id).maybeSingle();
        if (profile?.role !== 'admin') {
          return new Response(JSON.stringify({ error: 'Not allowed to send inquiry for this conversation' }), {
            status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
          });
        }
      }

      const insertPayload: Record<string, unknown> = {
        conversation_id: targetConversationId,
        sender_id: authData.user.id,
        body: sanitizeString(note || subject || 'Запрос покупателя'),
        message_type: 'user',
        created_at: new Date().toISOString()
      };
      const { error: insertError } = await admin.from('messages').insert(insertPayload);
      if (insertError) throw insertError;

      await admin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', targetConversationId);

      try {
        const { error: pushError } = await admin.functions.invoke('send-push', { body: { messageId: messageId || '' } });
        if (pushError) console.warn('Push notification failed:', pushError.message);
      } catch {
        // Push is non-critical
      }

      return new Response(JSON.stringify({ sent: true, conversation_id: targetConversationId }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (items) {
      if (!Array.isArray(items) || items.length < MIN_ITEMS || items.length > MAX_ITEMS) {
        throw new Error(`Items must be an array with ${MIN_ITEMS} to ${MAX_ITEMS} entries`);
      }
      for (const item of items) {
        if (!item || typeof item !== 'object') throw new Error('Invalid item');
        if (!Number.isInteger(item.product_id) || item.product_id <= 0) throw new Error('Invalid product_id');
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Invalid quantity');
      }
    }

    if (customer) {
      if (customer.email && !validateEmail(customer.email)) throw new Error('Invalid email');
      if (customer.phone && !validatePhone(customer.phone)) throw new Error('Invalid phone');
    }

    return new Response(JSON.stringify({ accepted: true, reason: 'Inquiry validated and queued' }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid request';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});