/**
 * checkout.js — Criação de sessão de pagamento Stripe
 *
 * POST /api/checkout
 * Headers: Authorization: Bearer <jwt>
 * Body (ideia normal):  { idea_id, option_idx }
 * Body (fase):          { idea_id, phase_idx }
 * Body (pack):          { idea_id, pack: true }
 *
 * Retorna: { checkout_url } — redirecionar o browser para esta URL
 *
 * Preços SEMPRE lidos da base de dados — nunca confiamos no cliente.
 * Comissão base: 10% (loyalty reductions a implementar futuramente).
 */

export const config = { path: '/api/checkout' };

const STRIPE_SECRET   = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL    = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON   = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC    = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL        = (process.env.SITE_URL ?? 'https://catchthisidea.com').replace(/\/+$/, '');
// ── Tabela de tiers de comissão (loyalty) ─────────────────────
// Espelha exatamente a tabela da landing page e do CLAUDE.md
function getLoyaltyTier(points) {
  if (points >= 500) return { name:'Mestre',       rate:0.05, prevPts:500, nextPts:null, next:null };
  if (points >= 250) return { name:'Especialista', rate:0.06, prevPts:250, nextPts:500,  next:'Mestre' };
  if (points >= 100) return { name:'Autor',        rate:0.07, prevPts:100, nextPts:250,  next:'Especialista' };
  if (points >= 30)  return { name:'Criador',      rate:0.08, prevPts:30,  nextPts:100,  next:'Autor' };
  if (points >= 10)  return { name:'Artesão',      rate:0.09, prevPts:10,  nextPts:30,   next:'Criador' };
  return               { name:'Faísca',       rate:0.10, prevPts:0,   nextPts:10,   next:'Artesão' };
}

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

// ── Stripe: criar checkout session via REST (sem SDK) ─────────
async function stripePost(endpoint, params) {
  if (!STRIPE_SECRET) throw new Error('STRIPE_SECRET_KEY não configurada');
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${STRIPE_SECRET}`,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? `Stripe error ${res.status}`);
  return data;
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405, origin);

  // ── 1. Autenticação ─────────────────────────────────────────
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Autenticação obrigatória' }, 401, origin);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
  const user = await userRes.json();

  // ── 2. Parse body ───────────────────────────────────────────
  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

  const { idea_id } = body;
  if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);

  // ── 3. Carregar ideia (validar que está ativa e aprovada) ───
  const ideaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ideas?id=eq.${idea_id}&select=id,seller_id,title_pt,desc_pt,options,phases,pack_price,status,moderation_status`,
    { headers: svc() }
  );
  if (!ideaRes.ok) return json({ error: 'Erro ao carregar ideia' }, 502, origin);
  const ideas = await ideaRes.json();
  if (!ideas.length) return json({ error: 'Ideia não encontrada' }, 404, origin);
  const idea = ideas[0];

  if (idea.status !== 'active' || idea.moderation_status !== 'approved')
    return json({ error: 'Ideia não disponível para compra' }, 400, origin);

  // Vendedor não pode comprar a própria ideia
  if (idea.seller_id === user.id)
    return json({ error: 'Não podes comprar a tua própria ideia' }, 400, origin);

  // ── 3.5. Calcular comissão real baseada no tier de loyalty do vendedor ──
  const sellerProfileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${idea.seller_id}&select=loyalty_points&limit=1`,
    { headers: svc() }
  );
  const sellerProfiles = sellerProfileRes.ok ? await sellerProfileRes.json() : [];
  const loyaltyPoints  = sellerProfiles[0]?.loyalty_points ?? 0;
  const { rate: commissionRate, name: tierName } = getLoyaltyTier(loyaltyPoints);

  // ── 4. Determinar preço e descrição da opção ────────────────
  let amountEur, optionType, optionName;

  if (body.pack === true) {
    // Pack completo de fases
    if (!idea.pack_price || idea.pack_price <= 0)
      return json({ error: 'Pack não disponível' }, 400, origin);
    amountEur  = Number(idea.pack_price);
    optionType = 'pack';
    optionName = 'Pack Completo';

  } else if (body.phase_idx !== undefined) {
    // Fase individual
    const phases = idea.phases;
    if (!Array.isArray(phases) || !phases[body.phase_idx])
      return json({ error: 'Fase inválida' }, 400, origin);
    const phase = phases[body.phase_idx];
    if (!phase.price || phase.price <= 0)
      return json({ error: 'Esta fase é gratuita' }, 400, origin);
    amountEur  = Number(phase.price);
    optionType = `phase_${body.phase_idx}`;
    optionName = phase.name || `Fase ${body.phase_idx + 1}`;

  } else {
    // Modalidade normal (opção do array options)
    const opts = idea.options;
    if (!Array.isArray(opts) || !opts.length)
      return json({ error: 'Sem opções de compra disponíveis' }, 400, origin);
    const idx = Number(body.option_idx ?? 0);
    if (idx < 0 || idx >= opts.length)
      return json({ error: 'Opção inválida' }, 400, origin);
    const opt  = opts[idx];
    amountEur  = Number(opt.price_eur);
    optionType = opt.type || `option_${idx}`;
    optionName = opt.name_pt || opt.name || 'Licença';
  }

  if (!amountEur || amountEur <= 0 || isNaN(amountEur))
    return json({ error: 'Preço inválido' }, 400, origin);

  const amountCents    = Math.round(amountEur * 100);
  const commissionEur  = Math.round(amountEur * commissionRate * 100) / 100;

  // ── 5. Criar sessão Stripe Checkout ────────────────────────
  let session;
  try {
    session = await stripePost('checkout/sessions', {
      'payment_method_types[]':                              'card',
      'line_items[0][price_data][currency]':                 'eur',
      'line_items[0][price_data][unit_amount]':              String(amountCents),
      'line_items[0][price_data][product_data][name]':       `${idea.title_pt} — ${optionName}`,
      'line_items[0][price_data][product_data][description]':
        (idea.desc_pt ?? '').slice(0, 500),
      'line_items[0][quantity]':                             '1',
      'mode':                                                'payment',
      'customer_email':                                      user.email ?? '',
      'success_url': `${SITE_URL}/index-app.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':  `${SITE_URL}/index-app.html?payment=cancelled`,
      // Metadata — usada no webhook para registar a compra
      'metadata[idea_id]':       idea_id,
      'metadata[idea_title]':    (idea.title_pt ?? '').slice(0, 200),
      'metadata[buyer_id]':      user.id,
      'metadata[seller_id]':     idea.seller_id,
      'metadata[option_type]':   optionType,
      'metadata[option_name]':   optionName,
      'metadata[amount_eur]':    String(amountEur),
      'metadata[commission_eur]':String(commissionEur),
      'metadata[seller_tier]':   tierName,
    });
  } catch (e) {
    console.error('[checkout] Stripe error:', e.message);
    return json({ error: e.message }, 502, origin);
  }

  return json({ checkout_url: session.url }, 200, origin);
};
