/**
 * cron-data-retention.js — Aplicação automática da política de retenção de dados
 *
 * Agenda: dia 1 de cada mês às 03:00 UTC
 *         (corre na mesma data que cron-monthly-summary mas 6 horas antes)
 *
 * Invoca a função SQL `enforce_data_retention()` que aplica:
 *  • admin_log      → eliminar entradas com mais de 2 anos
 *  • rejection_log  → eliminar entradas com mais de 1 ano (exceto utilizadores suspensos)
 *  • gdpr_requests  → anonimizar email_hash em pedidos concluídos há mais de 5 anos
 *  • transactions   → NUNCA eliminar (obrigação legal 7 anos — LGT Art. 52)
 *
 * RGPD Art. 5(1)(e) — limitação da conservação:
 *   "Os dados pessoais devem ser conservados de uma forma que permita a
 *    identificação dos titulares dos dados apenas durante o período necessário
 *    para as finalidades para as quais são tratados."
 */

export const config = {
  schedule: '0 3 1 * *', // Dia 1 de cada mês às 03:00 UTC
};

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_KEY;

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

/* ── Handler ─────────────────────────────────────── */

export default async () => {
  console.log('[cron-data-retention] A iniciar política de retenção de dados...');
  console.log(`[cron-data-retention] Data/hora: ${new Date().toISOString()}`);

  // Invocar a função SQL enforce_data_retention()
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/enforce_data_retention`, {
    method:  'POST',
    headers: svc(),
    body:    JSON.stringify({}),
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text().catch(() => '(sem corpo)');
    console.error(`[cron-data-retention] ✗ Erro ao invocar enforce_data_retention: HTTP ${rpcRes.status}`);
    console.error(`[cron-data-retention] Resposta: ${errText}`);
    return;
  }

  const result = await rpcRes.json().catch(() => null);

  if (result) {
    console.log('[cron-data-retention] ✓ Resultado:');
    console.log(`  admin_log_deleted:     ${result.admin_log_deleted     ?? 0} registos eliminados`);
    console.log(`  rejection_log_deleted: ${result.rejection_log_deleted ?? 0} registos eliminados`);
    console.log(`  gdpr_anonymized:       ${result.gdpr_anonymized       ?? 0} pedidos anonimizados`);
    console.log(`  transactions_kept:     intocado (obrigação legal 7 anos)`);
  } else {
    console.log('[cron-data-retention] ✓ enforce_data_retention executada (sem detalhe de contagem)');
  }

  console.log('[cron-data-retention] ✓ Concluído.');
};
