export const config = { path: '/api/auth' };

const SUPABASE_URL      = (process.env.SUPABASE_URL      ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const SITE_URL          = 'https://catchthisidea.netlify.app/index-app.html';
const ALLOWED_ORIGINS   = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

const supaHeaders = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY };
const adminHeaders = { 'Content-Type': 'application/json', 'apikey': SUPABASE_SVC_KEY, 'Authorization': `Bearer ${SUPABASE_SVC_KEY}` };

// ── Rate limiting ────────────────────────────────────────────
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;
function isRateLimited(ip) {
  const now = Date.now(), rec = attempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) { attempts.set(ip, { count: 1, firstAt: now }); return false; }
  rec.count++;
  return rec.count > MAX_TRIES;
}

// ── Validação ────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(e)    { return EMAIL_RE.test(String(e).toLowerCase()); }
function validatePassword(p) { return typeof p === 'string' && p.length >= 8; }

// ── CORS ─────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}

// ── Templates de email por idioma ────────────────────────────
const emailContent = {
  pt: {
    subject: 'Confirme a sua conta — Catch This Idea',
    greeting: (name) => name ? `Olá, ${name}!` : 'Olá!',
    body: 'Clique no botão abaixo para confirmar o seu email e ativar a sua conta no marketplace de ideias criativas.',
    btn: 'Confirmar email',
    expiry: 'Este link expira em 1 hora.',
    footer: 'Se não criou uma conta, pode ignorar este email.',
  },
  en: {
    subject: 'Confirm your account — Catch This Idea',
    greeting: (name) => name ? `Hi, ${name}!` : 'Hi!',
    body: 'Click the button below to confirm your email and activate your account on the creative ideas marketplace.',
    btn: 'Confirm email',
    expiry: 'This link expires in 1 hour.',
    footer: 'If you didn\'t create an account, you can ignore this email.',
  },
  fr: {
    subject: 'Confirmez votre compte — Catch This Idea',
    greeting: (name) => name ? `Bonjour, ${name}!` : 'Bonjour!',
    body: 'Cliquez sur le bouton ci-dessous pour confirmer votre email et activer votre compte sur le marketplace d\'idées créatives.',
    btn: 'Confirmer l\'email',
    expiry: 'Ce lien expire dans 1 heure.',
    footer: 'Si vous n\'avez pas créé de compte, vous pouvez ignorer cet email.',
  },
  es: {
    subject: 'Confirma tu cuenta — Catch This Idea',
    greeting: (name) => name ? `¡Hola, ${name}!` : '¡Hola!',
    body: 'Haz clic en el botón de abajo para confirmar tu email y activar tu cuenta en el marketplace de ideas creativas.',
    btn: 'Confirmar email',
    expiry: 'Este enlace expira en 1 hora.',
    footer: 'Si no creaste una cuenta, puedes ignorar este email.',
  },
};

function buildEmailHtml(lang, name, confirmUrl) {
  const t = emailContent[lang] ?? emailContent.pt;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f5ede0;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:8px;overflow:hidden">
    <div style="background:#e86000;padding:20px 32px">
      <span style="font-family:Georgia,serif;font-size:20px;color:#fff;font-style:italic">Catch · This · Idea</span>
    </div>
    <div style="padding:32px">
      <p style="font-family:Georgia,serif;font-size:22px;color:#1a0f00;margin:0 0 8px">${t.greeting(name)}</p>
      <p style="font-size:15px;color:#7a6040;line-height:1.65;margin:0 0 28px">${t.body}</p>
      <div style="text-align:center;margin-bottom:28px">
        <a href="${confirmUrl}"
           style="display:inline-block;background:#e86000;color:#fff;padding:14px 36px;border-radius:40px;font-size:15px;font-weight:600;text-decoration:none">
          ${t.btn}
        </a>
      </div>
      <p style="font-size:12px;color:#b09878;margin:0 0 4px">${t.expiry}</p>
      <p style="font-size:12px;color:#b09878;margin:0">${t.footer}</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendConfirmEmail(email, name, lang, confirmUrl) {
  const t = emailContent[lang] ?? emailContent.pt;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'Catch This Idea <noreply@catchthisidea.com>',
      to:   [email],
      subject: t.subject,
      html: buildEmailHtml(lang, name, confirmUrl),
    }),
  });
  return res.ok;
}

// ── Handler principal ────────────────────────────────────────
export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, origin);

  const ip = req.headers.get('x-nf-client-connection-ip')
          ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? 'unknown';
  if (isRateLimited(ip)) return json({ error: 'Demasiadas tentativas. Aguarde 15 minutos.' }, 429, origin);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'JSON inválido' }, 400, origin); }

  const { action, email, password, full_name, lang = 'pt' } = body;
  const safeLang      = ['pt','en','fr','es'].includes(lang) ? lang : 'pt';
  const sanitizedName = String(full_name ?? '').trim().slice(0, 100);
  const cleanEmail    = String(email ?? '').toLowerCase().trim();

  if (!action) return json({ error: 'action é obrigatório' }, 400, origin);

  // ── REGISTER ─────────────────────────────────────────────
  if (action === 'register') {
    if (!email || !password)         return json({ error: 'email e password são obrigatórios' }, 400, origin);
    if (!validateEmail(cleanEmail))  return json({ error: 'Email inválido' }, 400, origin);
    if (!validatePassword(password)) return json({ error: 'A password deve ter pelo menos 8 caracteres' }, 400, origin);

    // 1. Criar utilizador via Admin API (sem email automático)
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email:         cleanEmail,
        password,
        email_confirm: false,
        user_metadata: { full_name: sanitizedName, lang: safeLang },
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      const msg = createData.msg ?? createData.error_description ?? createData.message ?? 'Erro no registo';
      return json({ error: msg }, 400, origin);
    }

    // 2. Gerar link de confirmação
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        type:        'signup',
        email:       cleanEmail,
        redirect_to: SITE_URL,
      }),
    });

    const linkData = await linkRes.json();
    const confirmUrl = linkData.action_link ?? linkData.hashed_token
      ? `${SUPABASE_URL}/auth/v1/verify?token=${linkData.hashed_token}&type=signup&redirect_to=${SITE_URL}`
      : null;

    if (!confirmUrl) return json({ error: 'Erro ao gerar link de confirmação' }, 500, origin);

    // 3. Enviar email via Resend no idioma do utilizador
    await sendConfirmEmail(cleanEmail, sanitizedName, safeLang, confirmUrl);

    return json({ message: buildSuccessMessage(safeLang) }, 200, origin);
  }

  // ── LOGIN ────────────────────────────────────────────────
  if (action === 'login') {
    if (!email || !password)        return json({ error: 'email e password são obrigatórios' }, 400, origin);
    if (!validateEmail(cleanEmail)) return json({ error: 'Email inválido' }, 400, origin);

    const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({ email: cleanEmail, password }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: 'Email ou password incorretos' }, 401, origin);

    return json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      user: { id: data.user?.id, email: data.user?.email, name: data.user?.user_metadata?.full_name ?? '' },
    }, 200, origin);
  }

  // ── LOGOUT ───────────────────────────────────────────────
  if (action === 'logout') {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (token) await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { ...supaHeaders, 'Authorization': `Bearer ${token}` },
    }).catch(() => {});
    return json({ message: 'Sessão terminada' }, 200, origin);
  }

  return json({ error: 'action inválida' }, 400, origin);
};

function buildSuccessMessage(lang) {
  const msgs = {
    pt: 'Conta criada! Verifique o seu email para confirmar o registo.',
    en: 'Account created! Check your email to confirm your registration.',
    fr: 'Compte créé ! Vérifiez votre email pour confirmer votre inscription.',
    es: '¡Cuenta creada! Revisa tu email para confirmar tu registro.',
  };
  return msgs[lang] ?? msgs.pt;
}
