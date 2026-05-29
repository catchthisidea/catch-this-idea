/**
 * download.js — Geração de signed URLs para documentos privados (PDFs)
 *
 * GET /api/download?idea_id=<uuid>
 *
 * Controlo de acesso:
 *   - Vendedor → sempre pode descarregar o seu próprio documento
 *   - Comprador → só se existir registo de compra (tabela purchases — futuro)
 *   - Outros → 403
 *
 * O signed URL é válido por 1 hora e dá acesso direto ao ficheiro no Supabase Storage.
 */

export const config = { path: '/api/download' };

const SUPABASE_URL  = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_DOCS   = 'idea-docs';
const TTL_SECONDS   = 60 * 60; // 1 hora

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
const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'GET') return json({ error: 'Método não suportado' }, 405, origin);

  // ── 1. Autenticação obrigatória ─────────────────────────────
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Autenticação obrigatória' }, 401, origin);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
  const user = await userRes.json();

  // ── 2. Parâmetro idea_id ────────────────────────────────────
  const url     = new URL(req.url);
  const ideaId  = url.searchParams.get('idea_id');
  if (!ideaId) return json({ error: 'idea_id é obrigatório' }, 400, origin);

  // ── 3. Carregar ideia (seller_id + doc_url) ─────────────────
  const ideaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}&select=seller_id,doc_url,title_pt`,
    { headers: svc() }
  );
  if (!ideaRes.ok) return json({ error: 'Erro ao carregar ideia' }, 502, origin);
  const ideas = await ideaRes.json();
  if (!ideas.length) return json({ error: 'Ideia não encontrada' }, 404, origin);
  const idea = ideas[0];

  if (!idea.doc_url) return json({ error: 'Esta ideia não tem documento em PDF' }, 404, origin);

  // ── 4. Controlo de acesso ───────────────────────────────────
  const isSeller = idea.seller_id === user.id;

  // Verificar compra (quando sistema de pagamentos estiver implementado)
  let hasPurchased = false;
  try {
    const purchaseRes = await fetch(
      `${SUPABASE_URL}/rest/v1/purchases?idea_id=eq.${ideaId}&buyer_id=eq.${user.id}&select=id&limit=1`,
      { headers: svc() }
    );
    if (purchaseRes.ok) {
      const purchases = await purchaseRes.json();
      hasPurchased = purchases.length > 0;
    }
  } catch {
    // Tabela purchases ainda não existe — ignora silenciosamente
  }

  if (!isSeller && !hasPurchased) {
    return json({
      error:        'Documento disponível apenas após aquisição da ideia.',
      requires_purchase: true,   // frontend usa este campo para mostrar CTA de compra
      idea_id:      ideaId,
    }, 403, origin);
  }

  // ── 5. Gerar signed URL (válido por 1 hora) ─────────────────
  const signRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET_DOCS}/${idea.doc_url}`,
    {
      method:  'POST',
      headers: svc(),
      body:    JSON.stringify({ expiresIn: TTL_SECONDS }),
    }
  );

  if (!signRes.ok) {
    console.error('[download] Signed URL error', signRes.status);
    return json({ error: 'Erro ao gerar link de download.' }, 502, origin);
  }

  const { signedURL } = await signRes.json();

  return json({
    signed_url:  `${SUPABASE_URL}${signedURL}`,
    expires_in:  TTL_SECONDS,
    title:       idea.title_pt,
  }, 200, origin);
};
