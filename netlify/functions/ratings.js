export const config = { path: '/api/ratings' };

const SUPABASE_URL      = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC_KEY  = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
function anonH() {
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
}
function userH(token) {
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}
function svcH() {
  return { 'apikey': SUPABASE_SVC_KEY, 'Authorization': `Bearer ${SUPABASE_SVC_KEY}`, 'Content-Type': 'application/json' };
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const url   = new URL(req.url);
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');

  // ── GET — ratings for an idea or seller ─────────────────────
  if (req.method === 'GET') {
    const ideaId   = url.searchParams.get('idea_id');
    const sellerId = url.searchParams.get('seller_id');

    let endpoint;
    if (ideaId) {
      endpoint = `${SUPABASE_URL}/rest/v1/ratings?idea_id=eq.${ideaId}&order=created_at.desc&select=stars,comment,buyer_name,created_at`;
    } else if (sellerId) {
      endpoint = `${SUPABASE_URL}/rest/v1/ratings?seller_id=eq.${sellerId}&order=created_at.desc&limit=50&select=stars,comment,buyer_name,idea_id,created_at`;
    } else {
      return json({ error: 'idea_id ou seller_id é obrigatório' }, 400, origin);
    }

    const res = await fetch(endpoint, { headers: anonH() });
    if (!res.ok) return json({ error: 'Erro ao carregar avaliações' }, 502, origin);
    return json(await res.json(), 200, origin);
  }

  // ── POST — create rating ─────────────────────────────────────
  if (req.method === 'POST') {
    if (!token) return json({ error: 'Não autenticado' }, 401, origin);

    // Validate session
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: userH(token) });
    if (!userRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
    const user = await userRes.json();

    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

    const { idea_id, seller_id, stars, comment } = body;
    if (!idea_id || !seller_id) return json({ error: 'idea_id e seller_id são obrigatórios' }, 400, origin);

    const starsInt = parseInt(stars);
    if (!starsInt || starsInt < 1 || starsInt > 5)
      return json({ error: 'Avaliação deve ser entre 1 e 5 estrelas' }, 400, origin);

    // Verify buyer has a purchase for this idea
    const purchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/purchases?idea_id=eq.${idea_id}&buyer_id=eq.${user.id}&select=id&limit=1`,
      { headers: userH(token) }
    );
    const purchases = purchRes.ok ? await purchRes.json() : [];
    if (!purchases.length) return json({ error: 'Só compradores desta ideia podem avaliar' }, 403, origin);

    // Insert rating
    const ratingRes = await fetch(`${SUPABASE_URL}/rest/v1/ratings`, {
      method:  'POST',
      headers: { ...svcH(), 'Prefer': 'return=representation' },
      body: JSON.stringify({
        idea_id,
        buyer_id:   user.id,
        seller_id,
        stars:      starsInt,
        comment:    String(comment || '').trim().slice(0, 500) || null,
        buyer_name: user.user_metadata?.full_name ?? 'Comprador',
      }),
    });

    if (!ratingRes.ok) {
      const err = await ratingRes.json().catch(() => ({}));
      if (err.code === '23505') return json({ error: 'Já avaliaste esta ideia' }, 409, origin);
      return json({ error: 'Erro ao guardar avaliação' }, 502, origin);
    }

    // Update avg_rating on the idea atomically via RPC
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_idea_avg_rating`, {
      method:  'POST',
      headers: svcH(),
      body:    JSON.stringify({ idea_uuid: idea_id }),
    }).catch(() => {});

    return json((await ratingRes.json())[0], 201, origin);
  }

  return json({ error: 'Método não suportado' }, 405, origin);
};
