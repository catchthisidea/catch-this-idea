/**
 * gdpr.js — Endpoints de direitos RGPD do titular de dados
 *
 * Todos os pedidos requerem autenticação (Bearer token Supabase).
 *
 * GET  /api/gdpr?action=status           → histórico de pedidos do utilizador
 *
 * POST /api/gdpr { action: 'export' }
 *   Art. 15 + Art. 20 — exportar todos os dados pessoais em JSON
 *
 * POST /api/gdpr { action: 'delete' }
 *   Art. 17 — anonimizar conta (direito ao apagamento)
 *   Nota: registos financeiros preservados por obrigação legal (7 anos)
 *
 * POST /api/gdpr { action: 'consent', type, version }
 *   Art. 7 — registar ou revogar consentimento
 *
 * POST /api/gdpr { action: 'revoke_consent', type }
 *   Art. 7(3) — revogar consentimento específico
 */

export const config = { path: '/api/gdpr' };

import { createHash } from 'node:crypto';
import { sendEmail } from './_email.js';

/* ── Env ─────────────────────────────────────────────── */
const SUPABASE_URL  = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_KEY;
const SITE          = (process.env.SITE_URL ?? 'https://catchthisidea.com').replace(/\/+$/, '');

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

/* ── CORS ─────────────────────────────────────────────── */
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

/* ── Headers Supabase ────────────────────────────────── */
const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

/* ── Auth: validar JWT e devolver user ───────────────── */
async function getAuthUser(token) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/* ── Hash SHA-256 (para pseudonimização) ────────────── */
function sha256(s) {
  return createHash('sha256').update(String(s ?? '')).digest('hex');
}

/* ── Email de confirmação de eliminação de dados ────── */
async function sendDeletionConfirmEmail(email) {
  const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#f5ede0;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:540px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:10px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#e86000,#f07800);padding:22px 32px">
      <span style="font-family:Georgia,serif;font-size:21px;color:#fff;font-style:italic">Catch · This · Idea</span>
    </div>
    <div style="padding:32px">
      <p style="font-family:Georgia,serif;font-size:20px;color:#1a0f00;margin:0 0 14px">Os teus dados foram eliminados</p>
      <p style="font-size:14px;color:#7a6040;line-height:1.7;margin:0 0 16px">
        O teu pedido de eliminação de dados foi processado com sucesso ao abrigo do <strong>RGPD Art. 17</strong>.
      </p>
      <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:0 6px 6px 0;margin:0 0 20px">
        <p style="margin:0;font-size:13px;color:#166534">✓ Dados pessoais do perfil eliminados<br>
        ✓ Avaliações e comentários anonimizados<br>
        ✓ Conta desactivada<br>
        ✓ Consentimentos revogados</p>
      </div>
      <div style="background:#fff8e1;border-left:4px solid #f0b800;padding:12px 16px;border-radius:0 6px 6px 0;margin:0 0 20px">
        <p style="margin:0;font-size:12px;color:#7a5800">
          ⚠ Os registos de transações financeiras são preservados por 7 anos por obrigação legal
          (Lei Geral Tributária PT, Art. 52). Estes registos não contêm dados de cartão de pagamento.
        </p>
      </div>
      <p style="font-size:12px;color:#b09878;margin:0">
        Pedido processado: ${new Date().toLocaleDateString('pt-PT', { dateStyle: 'long' })}<br>
        Dúvidas: <a href="mailto:suporte@catchthisidea.com" style="color:#e86000">suporte@catchthisidea.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  return sendEmail(email, 'Os teus dados foram eliminados — Catch This Idea', html);
}

/* ── Email de confirmação de exportação ─────────────── */
async function sendExportConfirmEmail(email) {
  const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#f5ede0;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:540px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:10px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#e86000,#f07800);padding:22px 32px">
      <span style="font-family:Georgia,serif;font-size:21px;color:#fff;font-style:italic">Catch · This · Idea</span>
    </div>
    <div style="padding:32px">
      <p style="font-family:Georgia,serif;font-size:20px;color:#1a0f00;margin:0 0 14px">📦 Exportação de dados processada</p>
      <p style="font-size:14px;color:#7a6040;line-height:1.7;margin:0 0 16px">
        O teu pedido de exportação de dados (RGPD Art. 15 + Art. 20) foi processado.
        O ficheiro JSON com todos os teus dados foi entregue directamente no browser.
      </p>
      <p style="font-size:12px;color:#b09878;margin:0">
        Data: ${new Date().toLocaleDateString('pt-PT', { dateStyle: 'long' })}<br>
        Dúvidas: <a href="mailto:suporte@catchthisidea.com" style="color:#e86000">suporte@catchthisidea.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  return sendEmail(email, '📦 Exportação de dados RGPD — Catch This Idea', html);
}

/* ════════════════════════════════════════════════════
   HANDLER PRINCIPAL
════════════════════════════════════════════════════ */
export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  const user  = await getAuthUser(token);
  if (!user) return json({ error: 'Autenticação obrigatória' }, 401, origin);

  const url = new URL(req.url);

  /* ── GET: histórico de pedidos RGPD ─────────────── */
  if (req.method === 'GET') {
    const action = url.searchParams.get('action');
    if (action !== 'status') return json({ error: 'action inválida. Use: status' }, 400, origin);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/gdpr_requests?user_id=eq.${user.id}&order=requested_at.desc&select=type,status,requested_at,completed_at`,
      { headers: svc() }
    );

    if (!res.ok) return json({ error: 'Erro ao carregar pedidos' }, 502, origin);
    const requests = await res.json();
    return json({ requests }, 200, origin);
  }

  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405, origin);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

  const { action } = body;

  /* ── POST: exportar dados (Art. 15 + Art. 20) ───── */
  if (action === 'export') {
    // Verificar se já existe pedido pendente recente (evitar spam)
    const recentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gdpr_requests` +
      `?user_id=eq.${user.id}&type=eq.access&status=eq.completed` +
      `&requested_at=gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}` +
      `&limit=1`,
      { headers: svc() }
    );
    const recentRows = recentRes.ok ? await recentRes.json() : [];
    if (recentRows.length) {
      return json({ error: 'Já exportaste os teus dados nas últimas 24 horas. Aguarda antes de pedir novamente.' }, 429, origin);
    }

    // Chamar função SQL de exportação
    const exportRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/export_user_data`, {
      method:  'POST',
      headers: { ...svc(), 'Prefer': 'return=representation' },
      body:    JSON.stringify({ user_uuid: user.id }),
    });

    if (!exportRes.ok) return json({ error: 'Erro ao exportar dados' }, 502, origin);
    const exportData = await exportRes.json();

    // Registar pedido como completado
    await fetch(`${SUPABASE_URL}/rest/v1/gdpr_requests`, {
      method:  'POST',
      headers: { ...svc(), 'Prefer': 'return=minimal' },
      body:    JSON.stringify({
        user_id:      user.id,
        email_hash:   sha256(user.email),
        type:         'access',
        status:       'completed',
        completed_at: new Date().toISOString(),
        completed_by: 'system',
        notes:        'Exportação automática via /api/gdpr',
      }),
    });

    // Email de confirmação (não bloqueia)
    sendExportConfirmEmail(user.email).catch(() => {});

    // Devolver JSON como download
    const filename = `cti-dados-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type':        'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...corsHeaders(origin),
      },
    });
  }

  /* ── POST: eliminar dados (Art. 17) ─────────────── */
  if (action === 'delete') {
    // Verificar se já existe pedido de eliminação pendente ou recente
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gdpr_requests` +
      `?user_id=eq.${user.id}&type=eq.deletion&status=in.(pending,processing,completed)&limit=1`,
      { headers: svc() }
    );
    const pendingRows = pendingRes.ok ? await pendingRes.json() : [];
    if (pendingRows.length) {
      return json({
        error: 'Já existe um pedido de eliminação registado para esta conta.',
        status: pendingRows[0].status,
      }, 409, origin);
    }

    // Verificar se existem transações activas como vendedor com fundos por transferir
    // (registos de compra que ainda não foram reembolsados)
    // Prossegue de qualquer forma — os fundos da carteira mantêm-se até levantamento

    const originalEmail = user.email;

    // 1. Registar pedido como "em processamento"
    const reqInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/gdpr_requests`, {
      method:  'POST',
      headers: { ...svc(), 'Prefer': 'return=representation' },
      body:    JSON.stringify({
        user_id:      user.id,
        email_hash:   sha256(originalEmail),
        type:         'deletion',
        status:       'processing',
        completed_by: 'system',
      }),
    });
    const [reqRow] = reqInsertRes.ok ? await reqInsertRes.json() : [{}];

    // 2. Anonimizar todos os dados pessoais via função SQL
    const anonRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/anonymize_user`, {
      method:  'POST',
      headers: { ...svc(), 'Prefer': 'return=representation' },
      body:    JSON.stringify({ user_uuid: user.id }),
    });
    if (!anonRes.ok) {
      console.error('[gdpr:delete] anonymize_user RPC failed:', anonRes.status);
      // Reverter estado do pedido
      if (reqRow?.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/gdpr_requests?id=eq.${reqRow.id}`, {
          method:  'PATCH',
          headers: { ...svc(), 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ status: 'rejected', notes: 'Erro interno durante anonimização' }),
        });
      }
      return json({ error: 'Erro ao processar pedido. Tenta novamente ou contacta o suporte.' }, 500, origin);
    }

    // 3. Anonimizar email em auth.users + banir conta
    //    (feito DEPOIS do envio de email de confirmação)
    const anonEmail = `deleted-${user.id.slice(0, 8)}@catchthisidea.com`;

    // 4. Enviar email de confirmação ANTES de anonimizar o email
    await sendDeletionConfirmEmail(originalEmail).catch(() => {});

    // 5. Actualizar auth.users: email anónimo + ban permanente
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method:  'PUT',
      headers: svc(),
      body:    JSON.stringify({
        email:        anonEmail,
        ban_duration: '876000h', // ~100 anos
      }),
    }).catch(e => console.warn('[gdpr:delete] auth update error:', e.message));

    // 6. Marcar pedido como completado
    if (reqRow?.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/gdpr_requests?id=eq.${reqRow.id}`, {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({
          status:       'completed',
          completed_at: new Date().toISOString(),
          notes:        `Email anonimizado para ${anonEmail}. Transações preservadas (obrigação legal).`,
        }),
      });
    }

    console.log(`[gdpr:delete] ✓ Utilizador ${user.id.slice(0,8)}... anonimizado com sucesso.`);

    return json({
      ok: true,
      message: 'Os teus dados pessoais foram eliminados com sucesso ao abrigo do RGPD Art. 17. Recebeste um email de confirmação.',
      note: 'Os registos de transações financeiras são preservados por 7 anos por obrigação legal.',
    }, 200, origin);
  }

  /* ── POST: registar consentimento (Art. 7) ───────── */
  if (action === 'consent') {
    const { type, version = '1.0' } = body;
    const validTypes = ['terms', 'privacy', 'marketing_email'];
    if (!validTypes.includes(type)) {
      return json({ error: `type inválido. Válidos: ${validTypes.join(', ')}` }, 400, origin);
    }

    const ip        = req.headers.get('x-nf-client-connection-ip')
                   ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                   ?? 'unknown';
    const ipHash    = sha256(ip);
    const userAgent = req.headers.get('user-agent')?.slice(0, 200) || null;

    // Verificar se já existe consentimento activo para este tipo/versão
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/consents` +
      `?user_id=eq.${user.id}&type=eq.${type}&version=eq.${version}&revoked_at=is.null&limit=1`,
      { headers: svc() }
    );
    const existing = existRes.ok ? await existRes.json() : [];
    if (existing.length) {
      return json({ ok: true, message: 'Consentimento já registado para esta versão.' }, 200, origin);
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/consents`, {
      method:  'POST',
      headers: { ...svc(), 'Prefer': 'return=minimal' },
      body:    JSON.stringify({
        user_id:    user.id,
        type,
        version,
        ip_hash:    ipHash,
        user_agent: userAgent,
      }),
    });

    if (!res.ok) return json({ error: 'Erro ao registar consentimento' }, 502, origin);
    return json({ ok: true, message: `Consentimento '${type}' v${version} registado com sucesso.` }, 201, origin);
  }

  /* ── POST: revogar consentimento (Art. 7(3)) ──────── */
  if (action === 'revoke_consent') {
    const { type } = body;
    if (!type) return json({ error: 'type é obrigatório' }, 400, origin);

    // Só pode revogar marketing_email (terms e privacy são condição do contrato)
    if (type !== 'marketing_email') {
      return json({
        error: 'Apenas o consentimento de marketing pode ser revogado individualmente. ' +
               'Para eliminar a conta, usa action: "delete".',
      }, 400, origin);
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/consents?user_id=eq.${user.id}&type=eq.${type}&revoked_at=is.null`,
      {
        method:  'PATCH',
        headers: { ...svc(), 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ revoked_at: new Date().toISOString() }),
      }
    );

    return json({ ok: true, message: `Consentimento '${type}' revogado com sucesso.` }, 200, origin);
  }

  return json({ error: 'action inválida. Válidas: export, delete, consent, revoke_consent' }, 400, origin);
};
