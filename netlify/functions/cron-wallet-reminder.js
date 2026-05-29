/**
 * cron-wallet-reminder.js — Lembrete de saldo disponível para levantar
 *
 * Agenda: todas as quartas-feiras às 10:00 UTC
 *
 * Lógica:
 *  1. Busca carteiras com saldo >= €5 (tabela `wallets`)
 *  2. Exclui utilizadores que fizeram levantamento nos últimos 30 dias
 *     (tabela `transactions` com type='withdrawal')
 *  3. Envia email de lembrete a quem tiver saldo significativo parado
 *
 * Nota: o saldo é armazenado em cêntimos na tabela `wallets.balance`.
 */

export const config = {
  schedule: '0 10 * * 3', // Quarta-feira às 10:00 UTC
};

import { sendEmail, emailWalletReminder } from './_email.js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_KEY;
const MIN_CENTS    = 500; // €5 mínimo para enviar lembrete

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

/* ── Handler ─────────────────────────────────────── */

export default async () => {
  console.log('[cron-wallet-reminder] A iniciar...');

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 dias atrás

  // 1. Buscar carteiras com saldo >= mínimo
  const walletsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/wallets` +
    `?balance=gte.${MIN_CENTS}` +
    `&select=user_id,balance` +
    `&order=balance.desc` +
    `&limit=1000`,
    { headers: svc() }
  );

  if (!walletsRes.ok) {
    console.error('[cron-wallet-reminder] Erro ao buscar carteiras:', walletsRes.status);
    return;
  }

  const wallets = await walletsRes.json();
  console.log(`[cron-wallet-reminder] ${wallets.length} carteira(s) com saldo >= €${(MIN_CENTS / 100).toFixed(2)}`);

  if (!wallets.length) {
    console.log('[cron-wallet-reminder] Nenhuma carteira elegível. A terminar.');
    return;
  }

  // 2. Buscar levantamentos recentes (últimos 30 dias) para excluir quem já levantou
  const recentRes = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions` +
    `?type=eq.withdrawal` +
    `&created_at=gte.${cutoff.toISOString()}` +
    `&select=user_id`,
    { headers: svc() }
  );
  const recentTxs       = recentRes.ok ? await recentRes.json() : [];
  const recentWithdrawers = new Set(recentTxs.map(t => t.user_id));

  // 3. Filtrar: excluir quem levantou recentemente
  const eligible = wallets.filter(w => !recentWithdrawers.has(w.user_id));
  console.log(`[cron-wallet-reminder] ${eligible.length} elegível(is) após filtro de 30 dias`);

  if (!eligible.length) {
    console.log('[cron-wallet-reminder] Nenhum vendedor elegível. A terminar.');
    return;
  }

  const sellerIds = eligible.map(w => w.user_id);

  // 4. Buscar emails (auth) e nomes (profiles) em bulk
  const userMap  = {}; // userId → email
  const nameMap  = {}; // userId → display_name

  // Auth users (até 1000 de uma vez)
  const authRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    { headers: svc() }
  );
  if (authRes.ok) {
    const data = await authRes.json();
    for (const u of (data.users ?? [])) {
      if (u.id && sellerIds.includes(u.id)) userMap[u.id] = u.email ?? null;
    }
  }

  // Profiles (display_name)
  const ids     = sellerIds.map(id => `"${id}"`).join(',');
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids})&select=id,display_name`,
    { headers: svc() }
  );
  if (profRes.ok) {
    const rows = await profRes.json();
    for (const r of rows) nameMap[r.id] = r.display_name ?? null;
  }

  // 5. Enviar emails
  let sent = 0;
  let errs = 0;

  for (const wallet of eligible) {
    const sellerEmail = userMap[wallet.user_id] ?? null;
    if (!sellerEmail) continue;

    const balanceEur = (wallet.balance / 100).toFixed(2);
    const em = emailWalletReminder(nameMap[wallet.user_id] ?? null, balanceEur);
    const ok = await sendEmail(sellerEmail, em.subject, em.html).catch(() => false);

    if (ok) {
      sent++;
      console.log(`[cron-wallet-reminder] ✓ Email enviado → ${sellerEmail} | saldo=€${balanceEur}`);
    } else {
      errs++;
    }
  }

  console.log(`[cron-wallet-reminder] ✓ Concluído — enviados: ${sent} | erros: ${errs}`);
};
