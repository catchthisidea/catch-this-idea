/**
 * connect.js — Stripe Connect: onboarding e dashboard de vendedores
 *
 * POST /api/connect
 * Headers: Authorization: Bearer <jwt>
 *
 * Ações:
 *   { action: 'onboard' }   → cria conta Stripe Express + URL de onboarding (KYC)
 *   { action: 'check' }     → verifica se onboarding está completo (charges_enabled)
 *   { action: 'dashboard' } → URL de login no Stripe Express dashboard
 *   { action: 'status' }    → estado atual da conta sem chamada à Stripe API
 *
 * Fluxo típico:
 *   1. Frontend chama onboard → redireciona para onboarding_url (Stripe hosted)
 *   2. Stripe redireciona de volta para index-app.html?connect=return
 *   3. Frontend chama check → verifica charges_enabled, actualiza BD
 *   4. Checkout já funciona com split automático
 *
 * Variáveis de ambiente:
 *   STRIPE_SECRET_KEY        — chave secreta da plataforma (já existente)
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 *   SITE_URL
 */

export const config = { path: '/api/connect' };

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL  = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL      = (process.env.SITE_URL ?? 'https://catchthisidea.com').replace(/\/+$/, '');

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

// ── Stripe REST helpers ───────────────────────────────────────
async function stripeReq(method, endpoint, params = null) {
  if (!STRIPE_SECRET) throw new Error('STRIPE_SECRET_KEY não configurada');
  const opts = {
    method,
    headers: {
      'Authorization':  `Bearer ${STRIPE_SECRET}`,
      'Stripe-Version': '2024-06-20',
    },
  };
  if (params) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params).toString();
  }
  const res  = await fetch(`https://api.stripe.com/v1/${endpoint}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

// ── Supabase: buscar perfil do utilizador ─────────────────────
async function getProfile(userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_account_id,stripe_onboarding_complete&limit=1`,
    { headers: svc() }
  );
  const rows = res.ok ? await res.json() : [];
  return rows[0] ?? {};
}

async function patchProfile(userId, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method:  'PATCH',
    headers: { ...svc(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(data),
  });
}

// ── Handler principal ─────────────────────────────────────────
export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST')    return json({ error: 'Método não suportado' }, 405, origin);

  // Autenticação
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Autenticação obrigatória' }, 401, origin);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
  const user = await userRes.json();

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }
  const { action } = body;

  /* ── ONBOARD ──────────────────────────────────────────────── */
  if (action === 'onboard') {
    const profile = await getProfile(user.id);
    let accountId = profile.stripe_account_id ?? null;

    // Se já concluiu onboarding → devolver link de dashboard directamente
    if (accountId && profile.stripe_onboarding_complete) {
      try {
        const link = await stripeReq('POST', `accounts/${accountId}/login_links`, {});
        return json({ already_complete: true, dashboard_url: link.url }, 200, origin);
      } catch {
        return json({ already_complete: true }, 200, origin);
      }
    }

    // Criar conta Express se ainda não existe
    if (!accountId) {
      try {
        const account = await stripeReq('POST', 'accounts', {
          'type':    'express',
          'country': 'PT',
          'email':   user.email ?? '',
          'capabilities[card_payments][requested]': 'true',
          'capabilities[transfers][requested]':     'true',
          'business_type': 'individual',
          'metadata[user_id]': user.id,
          'metadata[platform]': 'catchthisidea',
        });
        accountId = account.id;
        await patchProfile(user.id, { stripe_account_id: accountId, stripe_onboarding_complete: false });
        console.log(`[connect:onboard] Conta Express criada: ${accountId} para user ${user.id}`);
      } catch (e) {
        console.error('[connect:onboard] Erro ao criar conta:', e.message);
        return json({ error: 'Erro ao criar conta de pagamento. Tente novamente.' }, 502, origin);
      }
    }

    // Gerar link de onboarding (Stripe hosted KYC)
    try {
      const link = await stripeReq('POST', 'account_links', {
        'account':     accountId,
        'refresh_url': `${SITE_URL}/index-app.html?connect=refresh`,
        'return_url':  `${SITE_URL}/index-app.html?connect=return`,
        'type':        'account_onboarding',
      });
      return json({ onboarding_url: link.url, account_id: accountId }, 200, origin);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }
  }

  /* ── CHECK ────────────────────────────────────────────────── */
  // Verifica junto da Stripe API se o onboarding está completo
  // Chamado pelo frontend quando o utilizador regressa do onboarding
  if (action === 'check') {
    const profile = await getProfile(user.id);

    if (!profile.stripe_account_id) {
      return json({ complete: false, reason: 'no_account' }, 200, origin);
    }

    try {
      const account  = await stripeReq('GET', `accounts/${profile.stripe_account_id}`);
      const complete = account.charges_enabled === true && account.payouts_enabled === true;

      if (complete && !profile.stripe_onboarding_complete) {
        await patchProfile(user.id, { stripe_onboarding_complete: true });
        console.log(`[connect:check] Onboarding concluído para user ${user.id}`);
      }

      return json({
        complete,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        account_id:      profile.stripe_account_id,
        requirements:    account.requirements?.currently_due ?? [],
      }, 200, origin);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }
  }

  /* ── DASHBOARD ────────────────────────────────────────────── */
  // Gera um link de login de sessão única para o Stripe Express dashboard
  if (action === 'dashboard') {
    const profile = await getProfile(user.id);

    if (!profile.stripe_account_id) {
      return json({ error: 'Conta de pagamento não configurada' }, 400, origin);
    }
    if (!profile.stripe_onboarding_complete) {
      return json({ error: 'Onboarding não concluído', needs_onboarding: true }, 400, origin);
    }

    try {
      const link = await stripeReq('POST', `accounts/${profile.stripe_account_id}/login_links`, {});
      return json({ dashboard_url: link.url }, 200, origin);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }
  }

  /* ── STATUS ───────────────────────────────────────────────── */
  // Estado local (sem chamada à Stripe) — para mostrar na UI
  if (action === 'status') {
    const profile = await getProfile(user.id);
    return json({
      has_account:  !!profile.stripe_account_id,
      complete:     profile.stripe_onboarding_complete ?? false,
      account_id:   profile.stripe_account_id ?? null,
    }, 200, origin);
  }

  return json({ error: 'action inválida. Use: onboard | check | dashboard | status' }, 400, origin);
};
