/**
 * ideas.js — CRUD de ideias + sanitização de inputs + moderação automática
 *
 * Fluxo de submissão (POST):
 *   1. Sanitizar todos os campos de texto
 *   2. Guardar com status='hidden', moderation_status='pending'
 *   3. Chamar Claude Haiku para análise de conteúdo
 *   4. Se approved (≥0.82) → status='active', moderation_status='approved'
 *   5. Se needs_review → fica pending (revisão humana)
 *   6. Se flagged → moderation_status='flagged' (revisão humana urgente)
 */

export const config = { path: '/api/ideas' };

import { analyzeIdea } from './moderation.js';

const SUPABASE_URL      = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY;

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

// ── Colunas de seleção ────────────────────────────────────────
const SELECT_PUBLIC  = [
  'id','seller_id','seller_name',
  'title_pt','title_en','title_fr','title_es',
  'desc_pt','desc_en','desc_fr','desc_es',
  'category','emoji','price_display','badge',
  'views_count','avg_rating','has_phases','phases','pack_price','options',
  'image_url',
  // doc_url NÃO incluído no público — PDF é privado, acedido via /api/download
].join(',');

const SELECT_PRIVATE = [
  'id','title_pt','category','emoji','status','moderation_status','moderation_reason',
  'views_count','sales_count','avg_rating','created_at','badge','image_url',
  'doc_url',  // vendedor vê se tem PDF associado
].join(',');

// ═══════════════════════════════════════════════════════════════
// SANITIZAÇÃO — prevenir XSS, injeção HTML, injeção SQL via texto
// ═══════════════════════════════════════════════════════════════

/**
 * Sanitiza string de input de utilizador.
 * Remove: tags HTML, atributos on*, protocolo javascript:, bytes de controlo.
 * Normaliza: espaços múltiplos, trunca ao comprimento máximo.
 */
function sanitize(input, maxLen = 2000) {
  if (input === null || input === undefined) return null;
  let s = String(input);

  // Remover tags HTML e atributos potencialmente perigosos
  s = s.replace(/<[^>]*>/g, '');                        // strip HTML tags
  s = s.replace(/javascript\s*:/gi, '');                 // strip js: protocol
  s = s.replace(/data\s*:\s*text\/html/gi, '');          // strip data URIs HTML
  s = s.replace(/on\w+\s*=\s*["']?[^"'>]*/gi, '');      // strip event handlers (onclick=, onerror=...)
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); // strip control characters
  s = s.replace(/\s{3,}/g, '  ');                        // collapse excessive whitespace
  s = s.trim();

  if (!s.length) return null;
  return s.slice(0, maxLen);
}

/** Sanitiza campos curtos (títulos, nomes) — mais restritivo */
function sanitizeShort(input, maxLen = 200) {
  const s = sanitize(input, maxLen);
  if (!s) return null;
  // Títulos não devem ter quebras de linha
  return s.replace(/[\r\n]/g, ' ');
}

/** Valida que um string é uma URL pública Supabase Storage (imagens) */
function sanitizeImageUrl(url, maxLen = 500) {
  if (!url) return null;
  const s = String(url).trim();
  if (!s.startsWith(SUPABASE_URL + '/storage/v1/object/public/idea-images/')) return null;
  return s.slice(0, maxLen);
}

/** Valida o path de um documento privado no bucket idea-docs.
 *  Formato esperado: "<user-uuid>/<file-uuid>.pdf"
 *  Nunca é uma URL pública — é apenas o path dentro do bucket.
 */
function sanitizeDocPath(path, maxLen = 300) {
  if (!path) return null;
  const s = String(path).trim();
  // Deve corresponder a: uuid/uuid.pdf  (sem barras extras, sem ..)
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(s)) return null;
  return s.slice(0, maxLen);
}

// Moderação via moderation.js (fonte única de verdade)

async function applyModeration(ideaId, result) {
  const { decision, reason } = result;
  const update = {
    moderation_status: decision === 'approved' ? 'approved'
                     : decision === 'flagged'  ? 'flagged'
                     : 'pending',
    moderation_reason: reason,
    moderated_at:      new Date().toISOString(),
    moderated_by:      'ai',
    ...(decision === 'approved' ? { status: 'active' } : {}),
  };

  await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}`, {
    method:  'PATCH',
    headers: { ...svcH(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(update),
  });

  return update;
}

// ═══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const url   = new URL(req.url);
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');

  // ── GET ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const ideaId   = url.searchParams.get('id');
    const topViews = url.searchParams.get('top_views');
    const sellerId = url.searchParams.get('seller_id');

    // Ideia específica por ID (para deep-link de perfis)
    if (ideaId) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}&status=eq.active&moderation_status=eq.approved&select=${SELECT_PUBLIC}`,
        { headers: anonH() }
      );
      if (!res.ok) return json({ error: 'Erro ao carregar ideia' }, 502, origin);
      const rows = await res.json();
      if (!rows.length) return json({ error: 'Ideia não encontrada' }, 404, origin);
      return json(rows[0], 200, origin);
    }

    // Carousel: top N por views (ativas E aprovadas)
    if (topViews) {
      const n = Math.min(parseInt(topViews) || 6, 20);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ideas?status=eq.active&moderation_status=eq.approved&order=views_count.desc&limit=${n}&select=${SELECT_PUBLIC}`,
        { headers: anonH() }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[ideas/carousel] Supabase error', res.status, JSON.stringify(errBody));
        return json({ error: 'Erro ao carregar ideias' }, 502, origin);
      }
      return json(await res.json(), 200, origin);
    }

    // Dashboard do vendedor: todas as suas ideias (qualquer estado)
    if (sellerId) {
      if (!token) return json({ error: 'Não autenticado' }, 401, origin);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ideas?seller_id=eq.${sellerId}&order=created_at.desc&select=${SELECT_PRIVATE}`,
        { headers: userH(token) }
      );
      if (!res.ok) {
        if (res.status === 401) return json({ error: 'Sessão inválida' }, 401, origin);
        const errBody = await res.json().catch(() => ({}));
        console.error('[ideas/seller] Supabase error', res.status, JSON.stringify(errBody));
        return json({ error: 'Erro ao carregar ideias' }, 502, origin);
      }
      return json(await res.json(), 200, origin);
    }

    // Listagem pública: só ativas E aprovadas
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ideas?status=eq.active&moderation_status=eq.approved&order=created_at.desc&select=${SELECT_PUBLIC}`,
      { headers: anonH() }
    );
    if (!res.ok) return json({ error: 'Erro ao carregar ideias' }, 502, origin);
    return json(await res.json(), 200, origin);
  }

  // ── POST — Criar ideia ────────────────────────────────────
  if (req.method === 'POST') {
    if (!token) return json({ error: 'Não autenticado' }, 401, origin);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: userH(token) });
    if (!userRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
    const user = await userRes.json();

    // Verificar se a conta está suspensa (não pode publicar ideias)
    const suspRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=suspended&limit=1`,
      { headers: svcH() }
    );
    const suspProfiles = suspRes.ok ? await suspRes.json() : [];
    if (suspProfiles[0]?.suspended) {
      return json({
        error: 'A tua conta está temporariamente suspensa. Não podes publicar novas ideias até a revisão ser concluída.',
        suspended: true,
      }, 403, origin);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

    // ── Sanitização de todos os campos de texto ──────────────
    const titlePt = sanitizeShort(body.title_pt);
    const cat     = sanitizeShort(body.category, 50);
    if (!titlePt) return json({ error: 'Título é obrigatório' }, 400, origin);
    if (!cat)     return json({ error: 'Categoria é obrigatória' }, 400, origin);

    const idea = {
      seller_id:     user.id,
      seller_name:   sanitizeShort(user.user_metadata?.full_name ?? user.email, 100),
      title_pt:      titlePt,
      title_en:      sanitizeShort(body.title_en),
      title_fr:      sanitizeShort(body.title_fr),
      title_es:      sanitizeShort(body.title_es),
      desc_pt:       sanitize(body.desc_pt),
      desc_en:       sanitize(body.desc_en),
      desc_fr:       sanitize(body.desc_fr),
      desc_es:       sanitize(body.desc_es),
      category:      cat,
      emoji:         sanitizeShort(body.emoji, 10) ?? '💡',
      price_display: sanitizeShort(body.price_display, 50),
      image_url:     sanitizeImageUrl(body.image_url),
      doc_url:       sanitizeDocPath(body.doc_url),   // path no bucket idea-docs (privado)
      options:       body.options    ?? null,  // JSON já validado pelo Supabase schema
      has_phases:    Boolean(body.has_phases),
      phases:        body.phases     ?? null,
      pack_price:    body.pack_price ? Number(body.pack_price) : null,
      // Estado inicial: hidden (não visível), pending (aguarda moderação)
      status:            'hidden',
      moderation_status: 'pending',
      moderation_reason: null,
    };

    // ── Guardar no Supabase ──────────────────────────────────
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/ideas`, {
      method:  'POST',
      headers: { ...svcH(), 'Prefer': 'return=representation' },
      body:    JSON.stringify(idea),
    });
    if (!insertRes.ok) {
      const err = await insertRes.json().catch(() => ({}));
      return json({ error: err.message ?? 'Erro ao publicar ideia' }, 502, origin);
    }
    const saved = (await insertRes.json())[0];

    // ── Moderação assíncrona (na mesma request, Haiku é rápido ~500ms) ──
    let moderationResult = null;
    try {
      moderationResult = await analyzeIdea(saved);
      await applyModeration(saved.id, moderationResult);
    } catch (e) {
      console.error('[ideas] moderation apply error:', e.message);
      // Não falha a request — ideia fica pending para revisão humana
    }

    // ── Resposta ao frontend ─────────────────────────────────
    const finalStatus = moderationResult?.decision === 'approved' ? 'active' : 'pending';
    return json({
      id:                saved.id,
      moderation_status: moderationResult?.decision === 'approved' ? 'approved'
                       : moderationResult?.decision === 'flagged'  ? 'flagged'
                       : 'pending',
      status:            finalStatus,
      // Não expor o reason se flagged (evitar gaming)
      message:           finalStatus === 'active'
        ? 'Ideia publicada com sucesso!'
        : 'Ideia submetida para revisão. Será publicada em até 72 horas úteis.',
    }, 201, origin);
  }

  // ── PATCH — Atualizar estado (ocultar/mostrar/invalidar) ──
  if (req.method === 'PATCH') {
    if (!token) return json({ error: 'Não autenticado' }, 401, origin);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

    const { id, status } = body;
    if (!id) return json({ error: 'id é obrigatório' }, 400, origin);
    if (!['active', 'hidden', 'invalidated'].includes(status))
      return json({ error: 'status inválido' }, 400, origin);

    // RLS: só o próprio dono pode alterar
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ideas?id=eq.${id}`,
      {
        method:  'PATCH',
        headers: { ...userH(token), 'Prefer': 'return=representation' },
        body:    JSON.stringify({ status }),
      }
    );
    if (!res.ok) return json({ error: 'Erro ao atualizar' }, 502, origin);
    const rows = await res.json();
    if (!rows.length) return json({ error: 'Ideia não encontrada ou sem permissão' }, 404, origin);
    return json(rows[0], 200, origin);
  }

  return json({ error: 'Método não suportado' }, 405, origin);
};
