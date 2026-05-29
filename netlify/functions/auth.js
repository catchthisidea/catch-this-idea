export const config = { path: '/api/auth' };

import { createHash }                                   from 'node:crypto';
import { sendEmail as sendTransactional, emailWelcome } from './_email.js';

const SUPABASE_URL      = (process.env.SUPABASE_URL      ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const SITE_URL          = ((process.env.SITE_URL ?? 'https://catchthisidea.com').replace(/\/+$/, '')) + '/index-app.html';
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
function validatePassword(p) {
  return typeof p === 'string'
    && p.length >= 8
    && /[A-Z]/.test(p)
    && /[a-z]/.test(p)
    && /[0-9]/.test(p);
}

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
    if (!validatePassword(password)) return json({ error: 'A password deve ter mínimo 8 caracteres, 1 maiúscula, 1 minúscula e 1 número.' }, 400, origin);

    // 0. Verificar blacklist antes de criar conta
    const blRes = await fetch(
      `${SUPABASE_URL}/rest/v1/blacklist?email=eq.${encodeURIComponent(cleanEmail)}&select=id&limit=1`,
      { headers: adminHeaders }
    ).catch(() => null);
    if (blRes?.ok) {
      const blRows = await blRes.json().catch(() => []);
      if (blRows.length) {
        return json({ error: 'Não é possível criar uma conta com este email. Se acreditas que se trata de um erro, contacta o suporte.' }, 403, origin);
      }
    }

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

    // 3. Registar consentimentos RGPD (Art. 7 — prova de consentimento)
    //    Feito antes de enviar emails para garantir registo mesmo se email falhar
    const ipHash   = createHash('sha256').update(ip).digest('hex'); // IP pseudonimizado
    const ua       = req.headers.get('user-agent')?.slice(0, 200) || null;
    const consentBase = { user_id: createData.id, version: '1.0', ip_hash: ipHash, user_agent: ua };
    Promise.allSettled([
      fetch(`${SUPABASE_URL}/rest/v1/consents`, {
        method:  'POST',
        headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ ...consentBase, type: 'terms' }),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/consents`, {
        method:  'POST',
        headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ ...consentBase, type: 'privacy' }),
      }),
    ]).catch(e => console.warn('[auth:register] consent recording:', e.message));

    // 4. Enviar email de confirmação (idioma do utilizador) + email de boas-vindas (PT)
    await sendConfirmEmail(cleanEmail, sanitizedName, safeLang, confirmUrl);

    // Boas-vindas separado — chega logo a seguir ao de confirmação
    const welcome = emailWelcome(sanitizedName);
    sendTransactional(cleanEmail, welcome.subject, welcome.html)
      .catch(e => console.warn('[auth:register] welcome email:', e.message));

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

    // Verificar se a conta está suspensa antes de devolver o token
    const userId = data.user?.id;
    if (userId) {
      const suspRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=suspended,suspension_reason&limit=1`,
        { headers: adminHeaders }
      ).catch(() => null);
      if (suspRes?.ok) {
        const suspProfiles = await suspRes.json().catch(() => []);
        if (suspProfiles[0]?.suspended) {
          const isBanned = String(suspProfiles[0].suspension_reason ?? '').startsWith('BANIDO:');
          return json({
            error: isBanned
              ? 'Esta conta foi banida permanentemente. Contacta o suporte se acreditas que se trata de um erro.'
              : 'A tua conta está temporariamente suspensa para revisão. Contacta o suporte para mais informações.',
            suspended: true,
          }, 403, origin);
        }
      }
    }

    return json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      user: { id: data.user?.id, email: data.user?.email, name: data.user?.user_metadata?.full_name ?? '' },
    }, 200, origin);
  }

  // ── REFRESH TOKEN ────────────────────────────────────────
  if (action === 'refresh') {
    const { refresh_token } = body;
    if (!refresh_token) return json({ error: 'refresh_token é obrigatório' }, 400, origin);

    const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: supaHeaders,
      body: JSON.stringify({ refresh_token }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: 'Sessão expirada. Por favor, inicie sessão novamente.' }, 401, origin);

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

  // ── FORGOT PASSWORD ──────────────────────────────────────────
  if (action === 'forgot') {
    // Não revelar se o email existe ou não — resposta sempre igual
    if (!email || !validateEmail(cleanEmail)) {
      return json({ message: buildForgotMessage(safeLang) }, 200, origin);
    }

    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        type:        'recovery',
        email:       cleanEmail,
        redirect_to: SITE_URL,
      }),
    });

    const linkData = await linkRes.json();
    const resetUrl = linkData.action_link ?? (linkData.hashed_token
      ? `${SUPABASE_URL}/auth/v1/verify?token=${linkData.hashed_token}&type=recovery&redirect_to=${SITE_URL}`
      : null);

    if (resetUrl) {
      await sendRecoveryEmail(cleanEmail, safeLang, resetUrl);
    }

    return json({ message: buildForgotMessage(safeLang) }, 200, origin);
  }

  // ── RESET PASSWORD ───────────────────────────────────────────
  if (action === 'reset') {
    const { new_password, access_token: resetToken } = body;
    if (!resetToken) return json({ error: 'Sessão inválida. Peça um novo link de recuperação.' }, 400, origin);
    if (!new_password || !validatePassword(new_password))
      return json({ error: 'A password deve ter mínimo 8 caracteres, 1 maiúscula, 1 minúscula e 1 número.' }, 400, origin);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${resetToken}`,
      },
      body: JSON.stringify({ password: new_password }),
    });

    const resetData = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: resetData.error_description ?? resetData.message ?? 'Erro ao redefinir a password.' }, 400, origin);
    }

    // Notificar o utilizador por email
    const userEmail = resetData.email;
    if (userEmail) {
      await sendPasswordChangedEmail(userEmail, safeLang).catch(() => {});
    }

    return json({ message: buildResetSuccessMessage(safeLang) }, 200, origin);
  }

  return json({ error: 'action inválida' }, 400, origin);
};

// ── Mensagens de sucesso ─────────────────────────────────────
function buildSuccessMessage(lang) {
  const msgs = {
    pt: 'Conta criada! Verifique o seu email para confirmar o registo.',
    en: 'Account created! Check your email to confirm your registration.',
    fr: 'Compte créé ! Vérifiez votre email pour confirmer votre inscription.',
    es: '¡Cuenta creada! Revisa tu email para confirmar tu registro.',
  };
  return msgs[lang] ?? msgs.pt;
}

function buildForgotMessage(lang) {
  const msgs = {
    pt: 'Se esse email estiver registado, receberá um link de recuperação em breve.',
    en: 'If that email is registered, you will receive a recovery link shortly.',
    fr: 'Si cet email est enregistré, vous recevrez un lien de récupération bientôt.',
    es: 'Si ese email está registrado, recibirás un enlace de recuperación en breve.',
  };
  return msgs[lang] ?? msgs.pt;
}

function buildResetSuccessMessage(lang) {
  const msgs = {
    pt: 'Password redefinida com sucesso! Pode entrar na sua conta.',
    en: 'Password reset successfully! You can now sign in.',
    fr: 'Mot de passe réinitialisé ! Vous pouvez maintenant vous connecter.',
    es: '¡Contraseña restablecida! Ya puedes iniciar sesión.',
  };
  return msgs[lang] ?? msgs.pt;
}

// ── Email de recuperação ─────────────────────────────────────
const recoveryContent = {
  pt: {
    subject:  'Recupere a sua password — Catch This Idea',
    greeting: (name) => name ? `Olá, ${name}!` : 'Olá!',
    body:     'Recebemos um pedido para redefinir a password da sua conta. Clique no botão abaixo para escolher uma nova password.',
    btn:      'Redefinir password',
    expiry:   'Este link expira em 1 hora.',
    footer:   'Se não pediu a recuperação de password, pode ignorar este email.',
  },
  en: {
    subject:  'Reset your password — Catch This Idea',
    greeting: (name) => name ? `Hi, ${name}!` : 'Hi!',
    body:     'We received a request to reset your account password. Click the button below to choose a new password.',
    btn:      'Reset password',
    expiry:   'This link expires in 1 hour.',
    footer:   "If you didn't request a password reset, you can ignore this email.",
  },
  fr: {
    subject:  'Réinitialisez votre mot de passe — Catch This Idea',
    greeting: (name) => name ? `Bonjour, ${name}!` : 'Bonjour!',
    body:     'Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.',
    btn:      'Réinitialiser le mot de passe',
    expiry:   'Ce lien expire dans 1 heure.',
    footer:   "Si vous n'avez pas demandé la réinitialisation, vous pouvez ignorer cet email.",
  },
  es: {
    subject:  'Restablece tu contraseña — Catch This Idea',
    greeting: (name) => name ? `¡Hola, ${name}!` : '¡Hola!',
    body:     'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el botón de abajo para elegir una nueva contraseña.',
    btn:      'Restablecer contraseña',
    expiry:   'Este enlace expira en 1 hora.',
    footer:   'Si no solicitaste el restablecimiento, puedes ignorar este email.',
  },
};

// ── Email de confirmação de alteração de password ────────────
const passwordChangedContent = {
  pt: {
    subject:  'A sua password foi alterada — Catch This Idea',
    greeting: (name) => name ? `Olá, ${name}!` : 'Olá!',
    body:     'A sua password foi alterada com sucesso. Se não foi você a fazer esta alteração, entre em contacto connosco imediatamente respondendo a este email.',
    notice:   'Esta é uma mensagem de segurança automática.',
    footer:   'Se foi você, pode ignorar este aviso.',
  },
  en: {
    subject:  'Your password has been changed — Catch This Idea',
    greeting: (name) => name ? `Hi, ${name}!` : 'Hi!',
    body:     'Your password has been successfully changed. If you did not make this change, please contact us immediately by replying to this email.',
    notice:   'This is an automated security notification.',
    footer:   'If this was you, you can safely ignore this notice.',
  },
  fr: {
    subject:  'Votre mot de passe a été modifié — Catch This Idea',
    greeting: (name) => name ? `Bonjour, ${name}!` : 'Bonjour!',
    body:     'Votre mot de passe a été modifié avec succès. Si vous n\'êtes pas à l\'origine de cette modification, contactez-nous immédiatement en répondant à cet email.',
    notice:   'Ceci est une notification de sécurité automatique.',
    footer:   'Si c\'était vous, vous pouvez ignorer cet avis.',
  },
  es: {
    subject:  'Tu contraseña ha sido cambiada — Catch This Idea',
    greeting: (name) => name ? `¡Hola, ${name}!` : '¡Hola!',
    body:     'Tu contraseña ha sido cambiada con éxito. Si no fuiste tú quien realizó este cambio, contáctanos inmediatamente respondiendo a este email.',
    notice:   'Esta es una notificación de seguridad automática.',
    footer:   'Si fuiste tú, puedes ignorar este aviso.',
  },
};

async function sendPasswordChangedEmail(email, lang) {
  const t = passwordChangedContent[lang] ?? passwordChangedContent.pt;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f5ede0;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:8px;overflow:hidden">
    <div style="background:#e86000;padding:20px 32px">
      <span style="font-family:Georgia,serif;font-size:20px;color:#fff;font-style:italic">Catch · This · Idea</span>
    </div>
    <div style="padding:32px">
      <p style="font-family:Georgia,serif;font-size:22px;color:#1a0f00;margin:0 0 8px">${t.greeting(null)}</p>
      <p style="font-size:15px;color:#7a6040;line-height:1.65;margin:0 0 20px">${t.body}</p>
      <div style="background:#fff8f0;border:1px solid #f5d0a8;border-radius:6px;padding:12px 16px;margin-bottom:24px">
        <p style="font-size:13px;color:#e86000;margin:0;font-weight:600">⚠ ${t.notice}</p>
      </div>
      <p style="font-size:12px;color:#b09878;margin:0">${t.footer}</p>
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from:    'Catch This Idea <noreply@catchthisidea.com>',
      to:      [email],
      subject: t.subject,
      html,
    }),
  });
  return res.ok;
}

async function sendRecoveryEmail(email, lang, resetUrl) {
  const t = recoveryContent[lang] ?? recoveryContent.pt;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f5ede0;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:8px;overflow:hidden">
    <div style="background:#e86000;padding:20px 32px">
      <span style="font-family:Georgia,serif;font-size:20px;color:#fff;font-style:italic">Catch · This · Idea</span>
    </div>
    <div style="padding:32px">
      <p style="font-family:Georgia,serif;font-size:22px;color:#1a0f00;margin:0 0 8px">${t.greeting(null)}</p>
      <p style="font-size:15px;color:#7a6040;line-height:1.65;margin:0 0 28px">${t.body}</p>
      <div style="text-align:center;margin-bottom:28px">
        <a href="${resetUrl}"
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from:    'Catch This Idea <noreply@catchthisidea.com>',
      to:      [email],
      subject: t.subject,
      html,
    }),
  });
  return res.ok;
}
