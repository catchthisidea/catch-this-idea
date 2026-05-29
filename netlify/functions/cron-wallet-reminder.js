/**
 * cron-wallet-reminder.js — Lembrete de saldo disponível para levantar
 *
 * Agenda: todas as quartas-feiras às 10:00 UTC
 * Envia: vendedores com saldo >= €5 que não levantaram nos últimos 30 dias
 *
 * Nota: usa wallet_balance_cents no perfil (em cêntimos).
 *       Mínimo €5 (500 cêntimos) para evitar notificações de valores irrisórios.
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

  // Calcular data de corte: sem levantamento nos últimos 30 dias
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Buscar perfis com saldo >= mínimo
  // Filtramos também por last_withdrawal_at (se existir) ou por created_at como proxy
  const profilesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles` +
    `?wallet_balance_cents=gte.${MIN_CENTS}` +
    `&select=id,display_name,wallet_balance_cents,last_withdrawal_at` +
    `&order=wallet_balance_cents.desc` +
    `&limit=1000`,
    { headers: svc() }
  );

  if (!profilesRes.ok) {
    console.error('[cron-wallet-reminder] Erro ao buscar perfis:', profilesRes.status);
    return;
  }

  const allProfiles = await profilesRes.json();
  console.log(`[cron-wallet-reminder] ${allProfiles.length} perfil(is) com saldo ≥ €${(MIN_CENTS / 100).toFixed(2)}`);

  // Filtrar: excluir quem levantou nos últimos 30 dias
  const eligible = allProfiles.filter(p => {
    if (!p.last_withdrawal_at) return true; // Nunca levantou → incluir
    return new Date(p.last_withdrawal_at) < cutoff;
  });

  console.log(`[cron-wallet-reminder] ${eligible.length} elegível(is) após filtro de 30 dias`);

  if (!eligible.length) {
    console.log('[cron-wallet-reminder] Nenhum vendedor elegível. A terminar.');
    return;
  }

  // Buscar emails dos utilizadores elegíveis
  const sellerIds = eligible.map(p => p.id);
  const userMap   = {};

  // Buscar em bulk (até 1000 utilizadores de uma vez)
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

  // Enviar emails
  let sent = 0;
  let errs = 0;

  for (const profile of eligible) {
    const sellerEmail = userMap[profile.id] ?? null;
    if (!sellerEmail) continue;

    const balanceEur = (profile.wallet_balance_cents / 100).toFixed(2);
    const em = emailWalletReminder(profile.display_name, balanceEur);
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
