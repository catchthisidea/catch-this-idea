export const config = { path: '/api/wallet' };

const SUPABASE_URL      = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Tabela de tiers (espelha checkout.js — fonte de verdade única no SQL) ──
function getLoyaltyTier(points) {
  if (points >= 500) return { name:'Mestre',       icon:'ti-crown',   rate:0.05, prevPts:500, nextPts:null, next:null };
  if (points >= 250) return { name:'Especialista', icon:'ti-award',   rate:0.06, prevPts:250, nextPts:500,  next:'Mestre' };
  if (points >= 100) return { name:'Autor',        icon:'ti-feather', rate:0.07, prevPts:100, nextPts:250,  next:'Especialista' };
  if (points >= 30)  return { name:'Criador',      icon:'ti-palette', rate:0.08, prevPts:30,  nextPts:100,  next:'Autor' };
  if (points >= 10)  return { name:'Artesão',      icon:'ti-hammer',  rate:0.09, prevPts:10,  nextPts:30,   next:'Criador' };
  return               { name:'Faísca',       icon:'ti-bolt',    rate:0.10, prevPts:0,   nextPts:10,   next:'Artesão' };
}

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, origin);

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Não autenticado' }, 401, origin);

  const authHeaders = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };

  const [walletRes, txRes, profileRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/wallets?select=balance,updated_at`, { headers: authHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*&order=created_at.desc&limit=20`, { headers: authHeaders }),
    // RLS garante que só devolve o perfil do próprio utilizador
    fetch(`${SUPABASE_URL}/rest/v1/profiles?select=loyalty_points&limit=1`, { headers: authHeaders }),
  ]);

  if (!walletRes.ok) {
    // Propagar 401 do Supabase para que o frontend possa fazer refresh do token
    if (walletRes.status === 401) return json({ error: 'Sessão inválida' }, 401, origin);
    return json({ error: 'Erro ao carregar carteira' }, 502, origin);
  }

  const wallets       = await walletRes.json();
  const wallet        = wallets[0] ?? { balance: 0 };
  const transactions  = txRes.ok ? await txRes.json() : [];
  const profileData   = profileRes.ok ? await profileRes.json() : [];
  const loyaltyPoints = profileData[0]?.loyalty_points ?? 0;
  const tier          = getLoyaltyTier(loyaltyPoints);

  return json({
    balance:        wallet.balance,
    balance_eur:    (wallet.balance / 100).toFixed(2),
    transactions,
    loyalty_points: loyaltyPoints,
    tier,
  }, 200, origin);
};
