export const config = { path: '/api/auth' };

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const headers = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
};

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const { action, email, password, full_name } = body;

  if (!action) return json({ error: 'action é obrigatório' }, 400);

  // ── REGISTER ──────────────────────────────────────────────
  if (action === 'register') {
    if (!email || !password) return json({ error: 'email e password são obrigatórios' }, 400);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password, data: { full_name: full_name ?? '' } }),
    });

    const data = await res.json();

    if (!res.ok) return json({ error: data.msg ?? data.error_description ?? 'Erro no registo' }, 400);

    return json({
      message: 'Conta criada! Verifique o seu email para confirmar.',
      user: { id: data.user?.id, email: data.user?.email },
    });
  }

  // ── LOGIN ─────────────────────────────────────────────────
  if (action === 'login') {
    if (!email || !password) return json({ error: 'email e password são obrigatórios' }, 400);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) return json({ error: 'Email ou password incorretos' }, 401);

    return json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      user: {
        id:    data.user?.id,
        email: data.user?.email,
        name:  data.user?.user_metadata?.full_name ?? '',
      },
    });
  }

  // ── LOGOUT ────────────────────────────────────────────────
  if (action === 'logout') {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (!token) return json({ message: 'ok' });

    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { ...headers, 'Authorization': `Bearer ${token}` },
    });

    return json({ message: 'Sessão terminada' });
  }

  return json({ error: 'action inválida' }, 400);
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
