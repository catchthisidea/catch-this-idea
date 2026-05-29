/**
 * profile.js — Perfil público do utilizador
 *
 * GET  /api/profile?user_id=UUID → perfil público + ideias + avaliações
 * PATCH /api/profile { display_name, bio } → atualizar perfil próprio
 */

export const config = { path: '/api/profile' };

const SUPABASE_URL    = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON   = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC    = process.env.SUPABASE_SERVICE_KEY;
const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
function svc() {
  return { 'apikey': SUPABASE_SVC, 'Authorization': `Bearer ${SUPABASE_SVC}`, 'Content-Type': 'application/json' };
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const url   = new URL(req.url);
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');

  // ── GET /api/profile?user_id=UUID ───────────────────────────
  if (req.method === 'GET') {
    const userId = url.searchParams.get('user_id');
    if (!userId) return json({ error: 'user_id é obrigatório' }, 400, origin);

    const [profileRes, userRes, ideasRes, allIdeasRes, reviewsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=display_name,bio,avatar_url`, { headers: svc() }),
      fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: svc() }),
      fetch(`${SUPABASE_URL}/rest/v1/ideas?seller_id=eq.${userId}&status=eq.active&moderation_status=eq.approved&select=id,title_pt,category,emoji,price_display,views_count,sales_count,avg_rating,image_url,has_phases,seller_id&order=created_at.desc`, { headers: svc() }),
      fetch(`${SUPABASE_URL}/rest/v1/ideas?seller_id=eq.${userId}&moderation_status=eq.approved&select=id,sales_count`, { headers: svc() }),
      fetch(`${SUPABASE_URL}/rest/v1/ratings?seller_id=eq.${userId}&order=created_at.desc&limit=20&select=stars,comment,buyer_name,created_at`, { headers: svc() }),
    ]);

    const profile  = profileRes.ok  ? (await profileRes.json())[0] ?? {} : {};
    const userData = userRes.ok     ? await userRes.json()              : {};
    const ideas    = ideasRes.ok    ? await ideasRes.json()             : [];
    const allIdeas = allIdeasRes.ok ? await allIdeasRes.json()          : [];
    const reviews  = reviewsRes.ok  ? await reviewsRes.json()           : [];

    const displayName = profile.display_name || userData.user_metadata?.full_name || 'Utilizador';
    const totalSales  = allIdeas.reduce((s, i) => s + (i.sales_count || 0), 0);
    const avgRating   = reviews.length
      ? Math.round(reviews.reduce((s, r) => s + r.stars, 0) / reviews.length * 10) / 10
      : 0;

    return json({
      user_id:      userId,
      display_name: displayName,
      bio:          profile.bio        ?? null,
      avatar_url:   profile.avatar_url ?? null,
      stats: {
        ideas_active: ideas.length,
        ideas_total:  allIdeas.length,
        total_sales:  totalSales,
        avg_rating:   avgRating,
        review_count: reviews.length,
      },
      ideas,
      reviews,
    }, 200, origin);
  }

  // ── PATCH /api/profile ───────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!token) return json({ error: 'Não autenticado' }, 401, origin);

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!authRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
    const user = await authRes.json();

    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

    const update = {};
    if (body.display_name !== undefined)
      update.display_name = String(body.display_name || '').trim().slice(0, 100) || null;
    if (body.bio !== undefined)
      update.bio = String(body.bio || '').trim().slice(0, 500) || null;

    if (!Object.keys(update).length) return json({ error: 'Nada para atualizar' }, 400, origin);

    // Upsert profiles (insert or update)
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method:  'POST',
      headers: { ...svc(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body:    JSON.stringify({ id: user.id, ...update }),
    });

    if (!upsertRes.ok) return json({ error: 'Erro ao guardar perfil' }, 502, origin);
    const saved = (await upsertRes.json())[0] ?? update;

    // Se o nome mudou, propagar para ideias existentes e metadados de auth
    if (update.display_name !== undefined) {
      await Promise.all([
        // Atualizar seller_name em todas as ideias do utilizador
        fetch(`${SUPABASE_URL}/rest/v1/ideas?seller_id=eq.${user.id}`, {
          method:  'PATCH',
          headers: { ...svc(), 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ seller_name: update.display_name }),
        }),
        // Atualizar full_name nos metadados do utilizador em Supabase Auth
        fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
          method:  'PUT',
          headers: svc(),
          body:    JSON.stringify({ user_metadata: { full_name: update.display_name } }),
        }),
      ]).catch(e => console.warn('[profile] propagation error:', e.message));
    }

    return json(saved, 200, origin);
  }

  return json({ error: 'Método não suportado' }, 405, origin);
};
