/**
 * cron-inactive-ideas.js — Lembrete para ideias ativas sem vendas há 90+ dias
 *
 * Agenda: todas as segundas-feiras às 10:00 UTC
 * Envia: apenas a ideias com 90–97 dias desde a publicação sem nenhuma venda
 *        (janela de 7 dias evita enviar o mesmo lembrete semana após semana)
 */

export const config = {
  schedule: '0 10 * * 1', // Segunda-feira às 10:00 UTC
};

import { sendEmail, emailInactiveIdea } from './_email.js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_KEY;

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

/* ── Handler ─────────────────────────────────────── */

export default async () => {
  console.log('[cron-inactive-ideas] A iniciar...');

  const now       = new Date();
  const cutoffOld = new Date(now.getTime() - 97 * 24 * 60 * 60 * 1000); // 97 dias atrás
  const cutoffNew = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 dias atrás

  // Ideias ativas, criadas entre 90 e 97 dias atrás, sem vendas
  // A janela de 7 dias garante que cada ideia recebe o email apenas uma vez
  const ideasRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ideas` +
    `?status=eq.active` +
    `&sales_count=eq.0` +
    `&created_at=gte.${cutoffOld.toISOString()}` +
    `&created_at=lt.${cutoffNew.toISOString()}` +
    `&select=id,title_pt,seller_id,created_at` +
    `&order=created_at.asc` +
    `&limit=500`,
    { headers: svc() }
  );

  if (!ideasRes.ok) {
    console.error('[cron-inactive-ideas] Erro ao buscar ideias:', ideasRes.status);
    return;
  }

  const ideas = await ideasRes.json();
  console.log(`[cron-inactive-ideas] ${ideas.length} ideia(s) inativa(s) encontrada(s)`);

  if (!ideas.length) {
    console.log('[cron-inactive-ideas] Nenhuma ideia elegível. A terminar.');
    return;
  }

  // Buscar dados dos vendedores em bulk (auth)
  const sellerIds = [...new Set(ideas.map(i => i.seller_id).filter(Boolean))];
  const userMap   = {};
  const nameMap   = {};

  // Auth users
  const authPage1 = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    { headers: svc() }
  );
  if (authPage1.ok) {
    const data = await authPage1.json();
    for (const u of (data.users ?? [])) {
      if (u.id) userMap[u.id] = u.email ?? null;
    }
  }

  // Profiles (display_name)
  if (sellerIds.length) {
    const ids      = sellerIds.map(id => `"${id}"`).join(',');
    const profRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids})&select=id,display_name`,
      { headers: svc() }
    );
    if (profRes.ok) {
      const rows = await profRes.json();
      for (const r of rows) nameMap[r.id] = r.display_name ?? null;
    }
  }

  // Enviar emails
  let sent = 0;
  let errs = 0;

  for (const idea of ideas) {
    const sellerEmail = userMap[idea.seller_id] ?? null;
    if (!sellerEmail) continue;

    const sellerName   = nameMap[idea.seller_id] ?? null;
    const createdAt    = new Date(idea.created_at);
    const daysSince    = Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));

    const em = emailInactiveIdea(sellerName, idea.title_pt, daysSince);
    const ok = await sendEmail(sellerEmail, em.subject, em.html).catch(() => false);

    if (ok) {
      sent++;
      console.log(`[cron-inactive-ideas] ✓ Email enviado → ${sellerEmail} | ideia="${idea.title_pt}"`);
    } else {
      errs++;
    }
  }

  console.log(`[cron-inactive-ideas] ✓ Concluído — enviados: ${sent} | erros: ${errs}`);
};
