export const config = { path: '/api/views' };

const SUPABASE_URL  = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
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

  return json({ counted: res.ok }, res.ok ? 200 : 502, origin);
};
