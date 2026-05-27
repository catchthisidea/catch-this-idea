export const config = { path: '/api/auth' };

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ALLOWED_ORIGINS   = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

const supaHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
};

// ── Rate limiting (em memória, por IP) ────────────────────────
const attempts = new Map(); // ip → { count, firstAt }
const WINDOW_MS  = 15 * 60 * 1000; // 15 minutos
const MAX_TRIES  = 10;              // máx tentativas por janela

function isRateLimited(ip) {
  const now  = Date.now();
  const rec  = attempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
    return false;
  }
  rec.count++;
  return rec.count > MAX_TRIES;
}

// ── Validação ─────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(e)    { return EMAIL_RE.test(String(e).toLowerCase()); }
function validatePassword(p) { return typeof p === 'string' && p.length >= 8; }

// ── CORS ──────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  // Rate limit por IP
  const ip = req.headers.get('x-nf-client-connection-ip')
          ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? 'unknown';

  if (isRateLimited(ip)) {
    return json({ error: 'Demasiadas tentativas. Aguarde 15 minutos.' }, 429, origin);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'JSON inválido' }, 400, origin); }

  const { action, email, password, full_name, lang = 'pt' } = body;
  const safeLang = ['pt','en','fr','es'].includes(lang) ? lang : 'pt';

  if (!action) return json({ error: 'action é obrigatório' }, 400, origin);

  // ── REGISTER ──────────────────────────────────────────────
  if (action === 'register') {
    if (!email || !password)       return json({ error: 'email e password são obrigatórios' }, 400, origin);
    if (!validateEmail(email))     return json({ error: 'Email inválido' }, 400, origin);
    if (!validatePassword(password)) return json({ error: 'A password deve ter pelo menos 8 caracteres' }, 400, origin);

    const sanitizedName = String(full_name ?? '').trim().slice(0, 100);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({
        email:    email.toLowerCase().trim(),
        password,
        data: { full_name: sanitizedName, lang: safeLang },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data.msg ?? data.error_description ?? data.message ?? JSON.stringify(data);
      return json({ error: msg }, 400, origin);
    }

    return json({
      message: 'Conta criada! Verifique o seu email para confirmar o registo.',
      user: { id: data.user?.id, email: data.user?.email },
    }, 200, origin);
  }

  // ── LOGIN ─────────────────────────────────────────────────
  if (action === 'login') {
    if (!email || !password)   return json({ error: 'email e password são obrigatórios' }, 400, origin);
    if (!validateEmail(email)) return json({ error: 'Email inválido' }, 400, origin);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
    });

    const data = await res.json();

    if (!res.ok) {
      // Resposta genérica — não revelar se o email existe
      return json({ error: 'Email ou password incorretos' }, 401, origin);
    }

    return json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      user: {
        id:    data.user?.id,
        email: data.user?.email,
        name:  data.user?.user_metadata?.full_name ?? '',
      },
    }, 200, origin);
  }

  // ── LOGOUT ────────────────────────────────────────────────
  if (action === 'logout') {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { ...supaHeaders, 'Authorization': `Bearer ${token}` },
      }).catch(() => {}); // silencioso — sessão local já foi limpa
    }
    return json({ message: 'Sessão terminada' }, 200, origin);
  }

  return json({ error: 'action inválida' }, 400, origin);
};

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
