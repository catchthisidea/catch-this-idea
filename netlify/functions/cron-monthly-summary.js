/**
 * cron-monthly-summary.js — Resumo mensal de vendas para vendedores ativos
 *
 * Agenda: dia 1 de cada mês às 9:00 UTC
 * Enviado a: todos os vendedores que tiveram pelo menos 1 venda no mês anterior
 */

export const config = {
  schedule: '0 9 1 * *', // 1º dia do mês às 09:00 UTC
};

import { sendEmail, emailMonthlySummary } from './_email.js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_KEY;

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

/* ── Helpers ─────────────────────────────────────── */

/** Devolve mapa { userId: { email, name } } de todos os utilizadores auth */
async function buildUserMap() {
  const map = {};
  let page  = 1;
  const PER = 1000;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${PER}`,
      { headers: svc() }
    );
    if (!res.ok) break;
    const data  = await res.json();
    const users = data.users ?? [];
    for (const u of users) {
      if (u.id) map[u.id] = { email: u.email ?? null, name: u.user_metadata?.full_name ?? null };
    }
    if (users.length < PER) break;
    page++;
  }
  return map;
}

/** Devolve mapa { userId: display_name } dos perfis */
async function buildProfileMap(userIds) {
  if (!userIds.length) return {};
  const ids = userIds.map(id => `"${id}"`).join(',');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids})&select=id,display_name,loyalty_points`,
    { headers: svc() }
  );
  if (!res.ok) return {};
  const rows = await res.json();
  const map  = {};
  for (const r of rows) map[r.id] = { name: r.display_name ?? null, points: r.loyalty_points ?? 0 };
  return map;
}

/* ── Handler ─────────────────────────────────────── */

export default async () => {
  console.log('[cron-monthly-summary] A iniciar...');

  // Calcular intervalo do mês anterior
  const now        = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),     1));
  const monthName  = monthStart.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  console.log(`[cron-monthly-summary] Mês: ${monthName} (${monthStart.toISOString()} → ${monthEnd.toISOString()})`);

  // Buscar todas as compras do mês anterior
  const purchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/purchases?status=eq.completed` +
    `&created_at=gte.${monthStart.toISOString()}` +
    `&created_at=lt.${monthEnd.toISOString()}` +
    `&select=seller_id,buyer_id,amount_eur,commission_eur,idea_id`,
    { headers: svc() }
  );

  if (!purchRes.ok) {
    console.error('[cron-monthly-summary] Erro ao buscar compras:', purchRes.status);
    return;
  }
  const purchases = await purchRes.json();
  console.log(`[cron-monthly-summary] ${purchases.length} compra(s) encontrada(s)`);

  if (!purchases.length) {
    console.log('[cron-monthly-summary] Sem vendas este mês. A terminar.');
    return;
  }

  // Agrupar por vendedor
  const bySeller = {};
  for (const p of purchases) {
    const sid = p.seller_id;
    if (!sid) continue;
    if (!bySeller[sid]) bySeller[sid] = { count: 0, earnings: 0, ideas: {} };

    bySeller[sid].count++;
    bySeller[sid].earnings += parseFloat(p.amount_eur ?? 0) - parseFloat(p.commission_eur ?? 0);
    // Contabilizar vendas por ideia para encontrar a mais vendida
    bySeller[sid].ideas[p.idea_id] = (bySeller[sid].ideas[p.idea_id] ?? 0) + 1;
  }

  const sellerIds = Object.keys(bySeller);
  console.log(`[cron-monthly-summary] ${sellerIds.length} vendedor(es) ativo(s)`);

  // Buscar dados de email e perfis
  const [userMap, profileMap] = await Promise.all([
    buildUserMap(),
    buildProfileMap(sellerIds),
  ]);

  // Buscar títulos das ideias mais vendidas
  const topIdeaIds = sellerIds.map(sid => {
    const ideas = bySeller[sid].ideas;
    return Object.keys(ideas).sort((a, b) => ideas[b] - ideas[a])[0] ?? null;
  }).filter(Boolean);

  let ideaTitleMap = {};
  if (topIdeaIds.length) {
    const ids    = [...new Set(topIdeaIds)].map(id => `"${id}"`).join(',');
    const ideasRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ideas?id=in.(${ids})&select=id,title_pt`,
      { headers: svc() }
    );
    if (ideasRes.ok) {
      const rows = await ideasRes.json();
      for (const r of rows) ideaTitleMap[r.id] = r.title_pt;
    }
  }

  // Enviar emails
  let sent = 0;
  let errs = 0;

  for (const sid of sellerIds) {
    const data    = bySeller[sid];
    const user    = userMap[sid]    ?? {};
    const profile = profileMap[sid] ?? {};

    if (!user.email) continue;

    const topIdeaId  = Object.keys(data.ideas).sort((a, b) => data.ideas[b] - data.ideas[a])[0];
    const topIdTitle = topIdeaId ? (ideaTitleMap[topIdeaId] ?? null) : null;

    const em = emailMonthlySummary(
      profile.name ?? user.name ?? null,
      monthName,
      data.count,
      Math.round(data.earnings * 100) / 100,
      topIdTitle,
      profile.points ?? 0
    );

    const ok = await sendEmail(user.email, em.subject, em.html).catch(() => false);
    if (ok) sent++; else errs++;
  }

  console.log(`[cron-monthly-summary] ✓ Concluído — enviados: ${sent} | erros: ${errs}`);
};
