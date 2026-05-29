/**
 * admin.js — Painel de administração (Catch This Idea)
 *
 * Autenticação: JWT Supabase + profiles.role = 'admin'
 *
 * GET  /api/admin?action=check           → { is_admin }
 * GET  /api/admin?action=pending         → ideias pendentes
 * GET  /api/admin?action=flagged         → ideias sinalizadas
 * GET  /api/admin?action=suspended       → utilizadores suspensos
 * GET  /api/admin?action=stats           → métricas do dashboard
 * GET  /api/admin?action=ideas           → lista paginada de ideias
 * GET  /api/admin?action=users           → lista paginada de utilizadores
 * GET  /api/admin?action=blacklist       → lista paginada de blacklist
 * GET  /api/admin?action=transactions    → lista paginada de compras
 * GET  /api/admin?action=logs            → lista paginada de admin_log
 *
 * POST /api/admin { action:'approve',         idea_id }
 * POST /api/admin { action:'reject',          idea_id, reason }
 * POST /api/admin { action:'remoderate',      idea_id }
 * POST /api/admin { action:'ban',             user_id, reason, phone? }
 * POST /api/admin { action:'unsuspend',       user_id }
 * POST /api/admin { action:'feature',         idea_id, featured }
 * POST /api/admin { action:'edit_idea',       idea_id, price?, category? }
 * POST /api/admin { action:'blacklist_add',   email?, phone?, reason }
 * POST /api/admin { action:'blacklist_remove',id }
 * POST /api/admin { action:'refund',          purchase_id, stripe_session_id, reason }
 */

export const config = { path: '/api/admin' };

import { analyzeIdea } from './moderation.js';

/* ── Env ── */
const SUPABASE_URL    = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON   = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC    = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET   = process.env.STRIPE_SECRET_KEY;
const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

/* ── CORS ── */
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

/* ── Supabase service-role headers ── */
const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

/* ── Helper: extract total count from Content-Range header ── */
function getCount(res) {
  const range = res.headers.get('Content-Range');
  return parseInt(range?.split('/')?.[1] ?? '0', 10);
}

/* ── Helper: log admin action to admin_log table ── */
async function logAdminAction(adminEmail, action, targetType, targetId, details) {
  await fetch(`${SUPABASE_URL}/rest/v1/admin_log`, {
    method:  'POST',
    headers: { ...svc(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify({
      admin_email:  adminEmail,
      action,
      target_type:  targetType,
      target_id:    String(targetId || ''),
      details,
    }),
  }).catch(e => console.warn('[admin_log]', e.message));
}

/* ════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════ */
async function getAdminUser(token) {
  if (!token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`,
    { headers: svc() }
  );
  if (!profileRes.ok) return null;
  const profiles = await profileRes.json();
  if (!profiles.length || profiles[0].role !== 'admin') return null;
  return user;
}

/* ════════════════════════════════════════════════
   MODERATION HELPERS (preserved)
════════════════════════════════════════════════ */

/* Apaga ficheiros de storage + registo da ideia */
async function purgeIdea(ideaId) {
  const ideaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}&select=image_url,doc_url,seller_id,title_pt`,
    { headers: svc() }
  );
  const rows = ideaRes.ok ? await ideaRes.json() : [];
  const idea = rows[0];
  if (!idea) return null;

  const storageOps = [];

  if (idea.image_url) {
    const marker = '/storage/v1/object/public/idea-images/';
    const idx    = idea.image_url.indexOf(marker);
    if (idx !== -1) {
      const imagePath = idea.image_url.slice(idx + marker.length);
      storageOps.push(
        fetch(`${SUPABASE_URL}/storage/v1/object/delete/idea-images`, {
          method: 'POST', headers: svc(),
          body:   JSON.stringify({ prefixes: [imagePath] }),
        }).catch(e => console.warn('[admin:purge] image delete error:', e.message))
      );
    }
  }

  if (idea.doc_url) {
    storageOps.push(
      fetch(`${SUPABASE_URL}/storage/v1/object/delete/idea-docs`, {
        method: 'POST', headers: svc(),
        body:   JSON.stringify({ prefixes: [idea.doc_url] }),
      }).catch(e => console.warn('[admin:purge] doc delete error:', e.message))
    );
  }

  if (storageOps.length) await Promise.allSettled(storageOps);

  await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}`, {
    method:  'DELETE',
    headers: { ...svc(), 'Prefer': 'return=minimal' },
  });

  return idea;
}

/* Regista rejeição e suspende utilizador se necessário (>=3 rejeições) */
async function logRejectionAndMaybeSuspend(userId, ideaId, ideaTitle, reason, adminEmail) {
  await fetch(`${SUPABASE_URL}/rest/v1/rejection_log`, {
    method:  'POST',
    headers: { ...svc(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify({
      user_id:     userId,
      idea_id:     String(ideaId),
      idea_title:  ideaTitle ?? '—',
      reason,
      rejected_by: adminEmail,
    }),
  }).catch(e => console.warn('[admin] rejection_log insert error:', e.message));

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=rejection_count`,
    { headers: svc() }
  );
  const profiles      = profileRes.ok ? await profileRes.json() : [];
  const prevCount     = profiles[0]?.rejection_count ?? 0;
  const newCount      = prevCount + 1;
  const shouldSuspend = newCount >= 3;

  const update = {
    rejection_count: newCount,
    ...(shouldSuspend ? {
      suspended:         true,
      suspended_at:      new Date().toISOString(),
      suspension_reason: `Suspensão automática após ${newCount} ideias rejeitadas.`,
    } : {}),
  };

  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method:  'PATCH',
    headers: { ...svc(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(update),
  });

  return { newCount, suspended: shouldSuspend };
}

/* Aplica decisão de moderação à ideia */
async function applyDecision(ideaId, decision, reason, by = 'human') {
  const update = {
    moderation_status: decision === 'approved' ? 'approved'
      : decision === 'flagged'  ? 'flagged'
      : decision === 'rejected' ? 'rejected'
      : 'pending',
    moderation_reason: reason,
    moderated_at:      new Date().toISOString(),
    moderated_by:      by,
    ...(decision === 'approved' ? { status: 'active' } : {}),
    ...(decision === 'rejected' ? { status: 'hidden' } : {}),
  };
  await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}`, {
    method: 'PATCH', headers: { ...svc(), 'Prefer': 'return=minimal' }, body: JSON.stringify(update),
  });
  return update;
}

/* Campos retornados na listagem de moderação */
const SELECT_ADMIN = [
  'id','title_pt','desc_pt','category','emoji','seller_id','seller_name',
  'moderation_status','moderation_reason','moderated_by','created_at','image_url',
].join(',');

/* ════════════════════════════════════════════════
   HANDLER PRINCIPAL
════════════════════════════════════════════════ */
export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  const url   = new URL(req.url);

  /* ════════════════════════════════════════════
     GET
  ════════════════════════════════════════════ */
  if (req.method === 'GET') {
    const action = url.searchParams.get('action');

    /* ── check: sem dados sensíveis, qualquer JWT pode perguntar ── */
    if (action === 'check') {
      const admin = await getAdminUser(token);
      return json({ is_admin: !!admin }, 200, origin);
    }

    const admin = await getAdminUser(token);
    if (!admin) return json({ error: 'Acesso não autorizado' }, 403, origin);

    /* ── pending / flagged ── */
    if (action === 'pending' || action === 'flagged') {
      const status = action === 'pending' ? 'pending' : 'flagged';
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/ideas?moderation_status=eq.${status}&order=created_at.asc&select=${SELECT_ADMIN}`,
        { headers: svc() }
      );
      if (!res.ok) return json({ error: 'Erro ao carregar ideias' }, 502, origin);
      return json(await res.json(), 200, origin);
    }

    /* ── suspended ── */
    if (action === 'suspended') {
      const susRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?suspended=eq.true&select=id,display_name,rejection_count,suspended_at,suspension_reason&order=suspended_at.desc`,
        { headers: svc() }
      );
      const profiles  = susRes.ok ? await susRes.json() : [];
      const suspended = profiles.filter(p => !String(p.suspension_reason ?? '').startsWith('BANIDO:'));

      const enriched = await Promise.all(suspended.map(async (p) => {
        const [userRes, logRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers: svc() }),
          fetch(
            `${SUPABASE_URL}/rest/v1/rejection_log?user_id=eq.${p.id}&order=rejected_at.desc&select=idea_title,reason,rejected_at,rejected_by`,
            { headers: svc() }
          ),
        ]);
        const user = userRes.ok ? await userRes.json() : {};
        const logs = logRes.ok  ? await logRes.json()  : [];
        return { ...p, email: user.email ?? '—', rejection_logs: logs };
      }));

      return json(enriched, 200, origin);
    }

    /* ── stats: métricas do dashboard ── */
    if (action === 'stats') {
      const now       = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Fazer 6 queries em paralelo
      const [pendingRes, flaggedRes, activeRes, usersRes, suspendedRes, purchasesRes] = await Promise.all([
        // Count pending moderation
        fetch(`${SUPABASE_URL}/rest/v1/ideas?moderation_status=eq.pending&select=id`, {
          headers: { ...svc(), 'Prefer': 'count=exact', 'Range': '0-0' },
        }),
        // Count flagged moderation
        fetch(`${SUPABASE_URL}/rest/v1/ideas?moderation_status=eq.flagged&select=id`, {
          headers: { ...svc(), 'Prefer': 'count=exact', 'Range': '0-0' },
        }),
        // Count active ideas
        fetch(`${SUPABASE_URL}/rest/v1/ideas?status=eq.active&select=id`, {
          headers: { ...svc(), 'Prefer': 'count=exact', 'Range': '0-0' },
        }),
        // Count all profiles
        fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id`, {
          headers: { ...svc(), 'Prefer': 'count=exact', 'Range': '0-0' },
        }),
        // Count suspended profiles
        fetch(`${SUPABASE_URL}/rest/v1/profiles?suspended=eq.true&select=id`, {
          headers: { ...svc(), 'Prefer': 'count=exact', 'Range': '0-0' },
        }),
        // All completed purchases for revenue calculation
        fetch(`${SUPABASE_URL}/rest/v1/purchases?status=eq.completed&select=amount_eur,commission_eur,created_at`, {
          headers: svc(),
        }),
      ]);

      const pending_count    = getCount(pendingRes);
      const flagged_count    = getCount(flaggedRes);
      const active_ideas     = getCount(activeRes);
      const total_users      = getCount(usersRes);
      const suspended_count  = getCount(suspendedRes);
      const purchases        = purchasesRes.ok ? await purchasesRes.json() : [];

      // Calculate revenue totals
      let total_revenue    = 0;
      let total_commission = 0;
      let month_revenue    = 0;
      let month_commission = 0;

      for (const p of purchases) {
        const amt = parseFloat(p.amount_eur     ?? 0);
        const com = parseFloat(p.commission_eur ?? 0);
        total_revenue    += amt;
        total_commission += com;
        if (p.created_at && p.created_at >= monthStart) {
          month_revenue    += amt;
          month_commission += com;
        }
      }

      return json({
        pending_count,
        flagged_count,
        active_ideas,
        total_users,
        suspended_count,
        total_revenue:    Math.round(total_revenue    * 100) / 100,
        total_commission: Math.round(total_commission * 100) / 100,
        month_revenue:    Math.round(month_revenue    * 100) / 100,
        month_commission: Math.round(month_commission * 100) / 100,
        total_sales:      purchases.length,
      }, 200, origin);
    }

    /* ── ideas: lista paginada com pesquisa e filtros ── */
    if (action === 'ideas') {
      const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit    = 20;
      const offset   = (page - 1) * limit;
      const q        = url.searchParams.get('q')        || '';
      const status   = url.searchParams.get('status')   || '';
      const category = url.searchParams.get('category') || '';
      const featured = url.searchParams.get('featured') || '';

      let qs = `select=id,title_pt,emoji,category,price,status,featured,created_at&order=created_at.desc`;
      if (q)        qs += `&title_pt=ilike.*${encodeURIComponent(q)}*`;
      if (status)   qs += `&status=eq.${encodeURIComponent(status)}`;
      if (category) qs += `&category=eq.${encodeURIComponent(category)}`;
      if (featured === '1') qs += `&featured=eq.true`;

      const rangeEnd = offset + limit - 1;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/ideas?${qs}`, {
        headers: { ...svc(), 'Prefer': 'count=exact', 'Range': `${offset}-${rangeEnd}` },
      });

      if (!res.ok) return json({ error: 'Erro ao carregar ideias' }, 502, origin);
      const total = getCount(res);
      const ideas = await res.json();
      return json({ ideas, total, page }, 200, origin);
    }

    /* ── users: lista paginada ── */
    if (action === 'users') {
      const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit  = 20;
      const offset = (page - 1) * limit;
      const q      = url.searchParams.get('q') || '';

      let qs = `select=id,display_name,loyalty_points,rejection_count,suspended&order=created_at.desc`;
      if (q) qs += `&display_name=ilike.*${encodeURIComponent(q)}*`;

      const rangeEnd = offset + limit - 1;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${qs}`, {
        headers: { ...svc(), 'Prefer': 'count=exact', 'Range': `${offset}-${rangeEnd}` },
      });

      if (!res.ok) return json({ error: 'Erro ao carregar utilizadores' }, 502, origin);
      const total    = getCount(res);
      const profiles = await res.json();

      // Enriquecer com email da auth em paralelo
      const users = await Promise.all(profiles.map(async (p) => {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers: svc() });
        const user    = userRes.ok ? await userRes.json() : {};
        return { ...p, email: user.email ?? null };
      }));

      return json({ users, total, page }, 200, origin);
    }

    /* ── blacklist: lista paginada ── */
    if (action === 'blacklist') {
      const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit    = 20;
      const offset   = (page - 1) * limit;
      const rangeEnd = offset + limit - 1;

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/blacklist?select=id,email,phone,reason,banned_by,created_at&order=created_at.desc`,
        { headers: { ...svc(), 'Prefer': 'count=exact', 'Range': `${offset}-${rangeEnd}` } }
      );

      if (!res.ok) return json({ error: 'Erro ao carregar blacklist' }, 502, origin);
      const total   = getCount(res);
      const entries = await res.json();
      return json({ entries, total, page }, 200, origin);
    }

    /* ── transactions: lista paginada ── */
    if (action === 'transactions') {
      const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit    = 20;
      const offset   = (page - 1) * limit;
      const rangeEnd = offset + limit - 1;

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/purchases?select=*&order=created_at.desc`,
        { headers: { ...svc(), 'Prefer': 'count=exact', 'Range': `${offset}-${rangeEnd}` } }
      );

      if (!res.ok) return json({ error: 'Erro ao carregar transações' }, 502, origin);
      const total        = getCount(res);
      const transactions = await res.json();
      return json({ transactions, total, page }, 200, origin);
    }

    /* ── logs: lista paginada ── */
    if (action === 'logs') {
      const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
      const limit    = 30;
      const offset   = (page - 1) * limit;
      const rangeEnd = offset + limit - 1;

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_log?select=*&order=created_at.desc`,
        { headers: { ...svc(), 'Prefer': 'count=exact', 'Range': `${offset}-${rangeEnd}` } }
      );

      if (!res.ok) return json({ error: 'Erro ao carregar logs' }, 502, origin);
      const total = getCount(res);
      const logs  = await res.json();
      return json({ logs, total, page }, 200, origin);
    }

    return json({ error: 'Ação inválida' }, 400, origin);
  }

  /* ════════════════════════════════════════════
     POST
  ════════════════════════════════════════════ */
  if (req.method === 'POST') {
    const admin = await getAdminUser(token);
    if (!admin) return json({ error: 'Acesso não autorizado' }, 403, origin);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

    const { action } = body;

    /* ── approve ── */
    if (action === 'approve') {
      const { idea_id } = body;
      if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);
      const update = await applyDecision(idea_id, 'approved', 'Aprovado manualmente', 'human');
      await logAdminAction(admin.email, 'approve', 'idea', idea_id, '');
      return json({ ok: true, update }, 200, origin);
    }

    /* ── reject ── */
    if (action === 'reject') {
      const { idea_id, reason } = body;
      if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);
      if (!reason)  return json({ error: 'Razão de rejeição obrigatória' }, 400, origin);

      const purged = await purgeIdea(idea_id);
      let suspension = null;
      if (purged?.seller_id) {
        suspension = await logRejectionAndMaybeSuspend(
          purged.seller_id, idea_id, purged.title_pt, reason, admin.email
        ).catch(e => { console.warn('[admin:reject] suspension error:', e.message); return null; });
      }
      await logAdminAction(admin.email, 'reject', 'idea', idea_id, reason);
      console.log(`[admin:reject] idea=${idea_id} reason="${reason}" by=${admin.email} suspended=${suspension?.suspended} at=${new Date().toISOString()}`);
      return json({ ok: true, deleted: true, suspension }, 200, origin);
    }

    /* ── remoderate ── */
    if (action === 'remoderate') {
      const { idea_id } = body;
      if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);

      const ideaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ideas?id=eq.${idea_id}&select=title_pt,desc_pt,category`,
        { headers: svc() }
      );
      if (!ideaRes.ok) return json({ error: 'Ideia não encontrada' }, 404, origin);
      const ideas = await ideaRes.json();
      if (!ideas.length) return json({ error: 'Ideia não encontrada' }, 404, origin);

      const result   = await analyzeIdea(ideas[0]);
      const decision = result.decision === 'approved' ? 'approved' : result.decision === 'flagged' ? 'flagged' : 'pending';
      const update   = await applyDecision(idea_id, decision, result.reason, 'ai');
      return json({ ok: true, moderation: result, update }, 200, origin);
    }

    /* ── ban ── */
    if (action === 'ban') {
      const { user_id, reason: banReason, phone } = body;
      if (!user_id)   return json({ error: 'user_id é obrigatório' }, 400, origin);
      if (!banReason) return json({ error: 'Razão de banimento é obrigatória' }, 400, origin);

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, { headers: svc() });
      if (!userRes.ok) return json({ error: 'Utilizador não encontrado' }, 404, origin);
      const user = await userRes.json();

      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}&select=display_name`,
        { headers: svc() }
      );
      const profiles = profileRes.ok ? await profileRes.json() : [];

      // Adicionar à blacklist
      await fetch(`${SUPABASE_URL}/rest/v1/blacklist`, {
        method:  'POST',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({
          email:        (user.email ?? '').toLowerCase() || null,
          phone:        phone?.trim() || null,
          user_id,
          display_name: profiles[0]?.display_name ?? null,
          reason:       banReason,
          banned_by:    admin.email,
        }),
      });

      // Banir conta no Supabase Auth (~100 anos)
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
        method: 'PUT', headers: svc(),
        body:   JSON.stringify({ ban_duration: '876000h' }),
      });

      // Marcar perfil como banido permanentemente
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ suspended: true, suspension_reason: `BANIDO: ${banReason}` }),
      });

      await logAdminAction(admin.email, 'ban', 'user', user_id, banReason);
      console.log(`[admin:ban] user=${user_id} email=${user.email} phone=${phone||'—'} reason="${banReason}" by=${admin.email} at=${new Date().toISOString()}`);
      return json({ ok: true, banned: true }, 200, origin);
    }

    /* ── unsuspend ── */
    if (action === 'unsuspend') {
      const { user_id } = body;
      if (!user_id) return json({ error: 'user_id é obrigatório' }, 400, origin);

      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ suspended: false, suspended_at: null, suspension_reason: null, rejection_count: 0 }),
      });

      await fetch(`${SUPABASE_URL}/rest/v1/rejection_log?user_id=eq.${user_id}`, {
        method:  'DELETE',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
      });

      await logAdminAction(admin.email, 'unsuspend', 'user', user_id, '');
      console.log(`[admin:unsuspend] user=${user_id} by=${admin.email} at=${new Date().toISOString()}`);
      return json({ ok: true }, 200, origin);
    }

    /* ── feature: toggle destaque de ideia ── */
    if (action === 'feature') {
      const { idea_id, featured } = body;
      if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);

      await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${idea_id}`, {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ featured: !!featured }),
      });

      await logAdminAction(admin.email, 'feature', 'idea', idea_id, featured ? 'em destaque' : 'destaque removido');
      return json({ ok: true }, 200, origin);
    }

    /* ── edit_idea: editar preço e/ou categoria ── */
    if (action === 'edit_idea') {
      const { idea_id, price, category } = body;
      if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);
      if (price === undefined && !category) return json({ error: 'Nada para atualizar' }, 400, origin);

      const update = {};
      if (price    !== undefined) update.price    = parseFloat(price);
      if (category)              update.category  = category;

      await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${idea_id}`, {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify(update),
      });

      const details = [price !== undefined ? `price=${price}` : '', category ? `category=${category}` : ''].filter(Boolean).join(', ');
      await logAdminAction(admin.email, 'edit_idea', 'idea', idea_id, details);
      return json({ ok: true }, 200, origin);
    }

    /* ── blacklist_add: adicionar entrada à blacklist ── */
    if (action === 'blacklist_add') {
      const { email, phone, reason } = body;
      if (!reason)        return json({ error: 'Motivo é obrigatório' }, 400, origin);
      if (!email && !phone) return json({ error: 'Email ou telemóvel são obrigatórios' }, 400, origin);

      const res = await fetch(`${SUPABASE_URL}/rest/v1/blacklist`, {
        method:  'POST',
        headers: { ...svc(), 'Prefer': 'return=representation' },
        body:    JSON.stringify({ email: email || null, phone: phone || null, reason, banned_by: admin.email }),
      });

      if (!res.ok) return json({ error: 'Erro ao adicionar à blacklist' }, 502, origin);
      const [row] = await res.json();
      await logAdminAction(admin.email, 'blacklist_add', 'blacklist', row?.id, `email=${email||'—'} phone=${phone||'—'} reason=${reason}`);
      return json({ ok: true, id: row?.id }, 200, origin);
    }

    /* ── blacklist_remove: remover entrada da blacklist ── */
    if (action === 'blacklist_remove') {
      const { id } = body;
      if (!id) return json({ error: 'id é obrigatório' }, 400, origin);

      await fetch(`${SUPABASE_URL}/rest/v1/blacklist?id=eq.${id}`, {
        method:  'DELETE',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
      });

      await logAdminAction(admin.email, 'blacklist_remove', 'blacklist', id, '');
      return json({ ok: true }, 200, origin);
    }

    /* ── refund: processar reembolso via Stripe ── */
    if (action === 'refund') {
      const { purchase_id, stripe_session_id, reason } = body;
      if (!purchase_id)      return json({ error: 'purchase_id é obrigatório' }, 400, origin);
      if (!stripe_session_id) return json({ error: 'stripe_session_id é obrigatório' }, 400, origin);
      if (!reason)           return json({ error: 'Motivo do reembolso é obrigatório' }, 400, origin);
      if (!STRIPE_SECRET)    return json({ error: 'STRIPE_SECRET_KEY não configurada' }, 500, origin);

      // 1. Obter a Checkout Session do Stripe para extrair o payment_intent
      const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripe_session_id}`, {
        headers: { Authorization: `Bearer ${STRIPE_SECRET}` },
      });
      if (!sessionRes.ok) return json({ error: 'Erro ao obter sessão Stripe' }, 502, origin);
      const session = await sessionRes.json();

      const paymentIntentId = session.payment_intent;
      if (!paymentIntentId) return json({ error: 'payment_intent não encontrado na sessão' }, 422, origin);

      // 2. Criar reembolso no Stripe
      const refundBody = new URLSearchParams({
        payment_intent: paymentIntentId,
        reason:         'requested_by_customer',
      });
      const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${STRIPE_SECRET}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: refundBody,
      });
      if (!refundRes.ok) {
        const err = await refundRes.json();
        return json({ error: err.error?.message || 'Erro ao criar reembolso' }, 502, origin);
      }
      const refund = await refundRes.json();

      // 3. Atualizar status da compra na base de dados
      await fetch(`${SUPABASE_URL}/rest/v1/purchases?id=eq.${purchase_id}`, {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ status: 'refunded', refunded_at: new Date().toISOString() }),
      });

      await logAdminAction(admin.email, 'refund', 'purchase', purchase_id, `reason=${reason} stripe_refund_id=${refund.id}`);
      return json({ ok: true, refund_id: refund.id }, 200, origin);
    }

    return json({ error: 'Ação inválida' }, 400, origin);
  }

  return json({ error: 'Método não suportado' }, 405, origin);
};
