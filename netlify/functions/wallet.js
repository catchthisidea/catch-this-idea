export const config = { path: '/api/wallet' };

const SUPABASE_URL      = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Validar token JWT
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Não autenticado' }, 401);

  const authHeaders = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };

  // Buscar carteira
  const walletRes = await fetch(
    `${SUPABASE_URL}/rest/v1/wallets?select=balance,updated_at`,
    { headers: authHeaders }
  );

  if (!walletRes.ok) return json({ error: 'Erro ao carregar carteira' }, 502);

  const wallets = await walletRes.json();
  const wallet  = wallets[0] ?? { balance: 0 };

  // Buscar últimas 20 transações
  const txRes = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?select=*&order=created_at.desc&limit=20`,
    { headers: authHeaders }
  );

  const transactions = txRes.ok ? await txRes.json() : [];

  return json({
    balance:      wallet.balance,           // em cêntimos
    balance_eur:  (wallet.balance / 100).toFixed(2),
    transactions,
  });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
