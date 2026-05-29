export const config = { path: '/api/support' };

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const DEST_EMAIL      = 'support@catchthisidea.com';
const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

// Rate limiting simples
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
function isRateLimited(ip) {
  const now = Date.now(), rec = attempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) { attempts.set(ip, { count: 1, firstAt: now }); return false; }
  rec.count++;
  return rec.count > MAX_TRIES;
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

const langLabel = { pt: 'PT', en: 'EN', fr: 'FR', es: 'ES' };

function buildHtml(name, email, lang, title, message) {
  const safeName    = name    ? name.replace(/</g,'&lt;').replace(/>/g,'&gt;') : '—';
  const safeEmail   = email   ? email.replace(/</g,'&lt;').replace(/>/g,'&gt;') : '—';
  const safeTitle   = title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeMessage = message.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  const code        = (langLabel[lang] || 'PT');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#1a0f00;max-width:600px;margin:0 auto;padding:2rem">
  <div style="background:#fff0e0;border-left:4px solid #e86000;padding:1rem 1.2rem;border-radius:4px;margin-bottom:1.5rem">
    <strong style="color:#e86000">Novo pedido de suporte</strong>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:.5rem 0;color:#7a6040;width:120px">Idioma</td><td style="padding:.5rem 0"><strong>${code}</strong></td></tr>
    <tr><td style="padding:.5rem 0;color:#7a6040">Nome</td><td style="padding:.5rem 0">${safeName}</td></tr>
    <tr><td style="padding:.5rem 0;color:#7a6040">Email</td><td style="padding:.5rem 0">${safeEmail ? `<a href="mailto:${safeEmail}" style="color:#e86000">${safeEmail}</a>` : '—'}</td></tr>
    <tr><td style="padding:.5rem 0;color:#7a6040;vertical-align:top">Assunto</td><td style="padding:.5rem 0"><strong>${safeTitle}</strong></td></tr>
    <tr><td style="padding:.5rem 0;color:#7a6040;vertical-align:top">Mensagem</td><td style="padding:.5rem 0;line-height:1.6">${safeMessage}</td></tr>
  </table>
  <hr style="border:none;border-top:1px solid #ddd0b8;margin:1.5rem 0">
  <p style="font-size:12px;color:#7a6040">Catch This Idea · catchthisidea.com</p>
</body></html>`;
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, origin);

  const ip = req.headers.get('x-nf-client-connection-ip')
          ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? 'unknown';
  if (isRateLimited(ip)) return json({ error: 'Demasiadas tentativas. Aguarde 15 minutos.' }, 429, origin);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Payload inválido' }, 400, origin); }

  const { name = '', email = '', lang = 'pt', title = '', message = '' } = body;

  const safeTitle   = String(title).trim().slice(0, 300);
  const safeMessage = String(message).trim().slice(0, 5000);
  const safeName    = String(name).trim().slice(0, 100);
  const safeEmail   = String(email).trim().slice(0, 200);

  if (!safeTitle)   return json({ error: 'O assunto é obrigatório.' }, 400, origin);
  if (!safeMessage) return json({ error: 'A mensagem é obrigatória.' }, 400, origin);

  const code    = langLabel[lang] || 'PT';
  const subject = `[Support][${code}] - ${safeTitle}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from:     'Catch This Idea <noreply@catchthisidea.com>',
      to:       [DEST_EMAIL],
      reply_to: safeEmail || undefined,
      subject,
      html:     buildHtml(safeName, safeEmail, lang, safeTitle, safeMessage),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
    return json({ error: 'Falha ao enviar. Tente novamente.' }, 502, origin);
  }

  return json({ ok: true }, 200, origin);
};
