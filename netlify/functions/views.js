export const config = { path: '/api/views' };

import { sendEmail, emailViewMilestone } from './_email.js';

const SUPABASE_URL     = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
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

// In-memory cooldown: same IP + idea_id only counts once per 30 min
const viewLog = new Map();
function canCount(ip, ideaId) {
  const key = `${ip}:${ideaId}`;
  const now  = Date.now();
  const last = viewLog.get(key);
  if (last && now - last < 30 * 60 * 1000) return false;
  viewLog.set(key, now);
  // Prevent the map from growing forever
  if (viewLog.size > 5000) {
    const oldest = viewLog.entries().next().value[0];
    viewLog.delete(oldest);
  }
  return true;
}

const svc = {
  'apikey':        SUPABASE_SVC_KEY,
  'Authorization': `Bearer ${SUPABASE_SVC_KEY}`,
  'Content-Type':  'application/json',
};

/* ── Milestones de visualizações ─────────────────── */
const MILESTONES = [10, 50, 100, 500, 1000];

/** Devolve o próximo milestone a notificar (ou null se já atingiu todos) */
function nextMilestone(alreadyNotified) {
  return MILESTONES.find(m => m > alreadyNotified) ?? null;
}

/**
 * Verifica se a ideia atingiu um novo milestone de visualizações e envia email.
 * Corre em background (não bloqueia a resposta ao cliente).
 */
async function checkViewMilestone(ideaId) {
  // Buscar estado atual da ideia
  const ideaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}&select=seller_id,title_pt,views_count,views_milestone_notified&limit=1`,
    { headers: svc }
  );
  if (!ideaRes.ok) return;

  const rows = await ideaRes.json();
  const idea = rows[0];
  if (!idea) return;

  const views     = idea.views_count              ?? 0;
  const notified  = idea.views_milestone_notified ?? 0;
  const milestone = nextMilestone(notified);

  // Sem milestone a notificar ou ainda não chegou lá
  if (!milestone || views < milestone) return;

  // Actualizar imediatamente para evitar duplos envios
  await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}`, {
    method:  'PATCH',
    headers: { ...svc, 'Prefer': 'return=minimal' },
    body:    JSON.stringify({ views_milestone_notified: milestone }),
  });

  // Buscar email e nome do vendedor
  const [authRes, profileRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/auth/v1/admin/users/${idea.seller_id}`, { headers: svc }),
    fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${idea.seller_id}&select=display_name&limit=1`,
      { headers: svc }
    ),
  ]);

  const sellerUser = authRes.ok    ? await authRes.json()    : {};
  const profiles   = profileRes.ok ? await profileRes.json() : [];

  const sellerEmail = sellerUser.email ?? null;
  const sellerName  = profiles[0]?.display_name ?? null;

  if (sellerEmail) {
    const em = emailViewMilestone(sellerName, idea.title_pt, milestone);
    await sendEmail(sellerEmail, em.subject, em.html);
    console.log(`[views] Milestone ${milestone} → vendedor=${idea.seller_id} ideia=${ideaId}`);
  }
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405, origin);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

  const { idea_id } = body;
  if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);

  const ip = req.headers.get('x-nf-client-connection-ip')
          ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? 'unknown';

  if (!canCount(ip, idea_id)) return json({ counted: false }, 200, origin);

  // Call the RPC function (defined in SQL below)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_idea_views`, {
    method:  'POST',
    headers: svc,
    body:    JSON.stringify({ idea_uuid: idea_id }),
  });

  // Verificar milestones em background (não bloqueia resposta)
  if (res.ok) {
    checkViewMilestone(idea_id)
      .catch(e => console.warn('[views] milestone check error:', e.message));
  }

  return json({ counted: res.ok }, res.ok ? 200 : 502, origin);
};
