/**
 * webhook.js — Handler de webhooks Stripe
 *
 * POST /api/webhook  (chamado pelo Stripe, não pelo browser)
 *
 * Eventos tratados:
 *   checkout.session.completed → regista compra, credita carteira do vendedor
 *
 * Segurança: verifica assinatura HMAC-SHA256 do Stripe antes de processar.
 * NUNCA confiar no payload sem verificar a assinatura.
 */

export const config = { path: '/api/webhook' };

import { createHmac, timingSafeEqual } from 'crypto';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL          = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC          = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY        = process.env.RESEND_API_KEY;

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal',
});

// ── Verificação da assinatura Stripe ─────────────────────────
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  try {
    const t   = sigHeader.match(/t=(\d+)/)?.[1];
    const sig = sigHeader.match(/v1=([a-f0-9]+)/)?.[1];
    if (!t || !sig) return false;

    // Rejeitar webhooks com mais de 5 minutos (replay attack)
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

    const expected = createHmac('sha256', secret)
      .update(`${t}.${rawBody}`)
      .digest('hex');

    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ── Helpers Supabase ──────────────────────────────────────────
async function supabaseInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: svc(),
    body:    JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Supabase insert ${table}: ${err.message ?? res.status}`);
  }
}

async function supabaseRpc(fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: { ...svc(), 'Prefer': 'return=representation' },
    body:    JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[webhook] RPC ${fn} error:`, err.message ?? res.status);
  }
}

// ── Email de confirmação ao comprador ─────────────────────────
async function sendPurchaseEmail(buyerEmail, ideaTitle, optionName, amountEur) {
  if (!RESEND_API_KEY || !buyerEmail) return;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f5ede0;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:8px;overflow:hidden">
    <div style="background:#e86000;padding:20px 32px">
      <span style="font-family:Georgia,serif;font-size:20px;color:#fff;font-style:italic">Catch · This · Idea</span>
    </div>
    <div style="padding:32px">
      <p style="font-family:Georgia,serif;font-size:22px;color:#1a0f00;margin:0 0 8px">🎉 Aquisição confirmada!</p>
      <p style="font-size:15px;color:#7a6040;line-height:1.65;margin:0 0 20px">
        O teu pagamento foi processado com sucesso. Aqui estão os detalhes da tua compra:
      </p>
      <div style="background:#fff0e0;border:1px solid #f5d0a8;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <p style="margin:0 0 6px;font-size:14px;color:#7a6040">Ideia adquirida</p>
        <p style="margin:0 0 12px;font-size:17px;font-weight:600;color:#1a0f00">${(ideaTitle || '').replace(/</g,'&lt;')}</p>
        <p style="margin:0 0 4px;font-size:13px;color:#7a6040">Modalidade: <strong>${(optionName || '').replace(/</g,'&lt;')}</strong></p>
        <p style="margin:0;font-size:13px;color:#7a6040">Valor pago: <strong style="color:#e86000">€${Number(amountEur).toFixed(2)}</strong></p>
      </div>
      <p style="font-size:14px;color:#7a6040;line-height:1.6;margin:0 0 8px">
        Acede à tua carteira em <a href="https://catchthisidea.com" style="color:#e86000">catchthisidea.com</a> para descarregar os documentos associados à ideia.
      </p>
      <p style="font-size:12px;color:#b09878;margin:0">Se tiveres dúvidas, responde a este email.</p>
    </div>
  </div>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from:    'Catch This Idea <noreply@catchthisidea.com>',
      to:      [buyerEmail],
      subject: `✓ Aquisição confirmada — ${ideaTitle || 'Catch This Idea'}`,
      html,
    }),
  }).catch(e => console.error('[webhook] Resend error:', e.message));
}

// ── Handler do evento checkout.session.completed ──────────────
async function handleCheckoutCompleted(session) {
  const {
    idea_id, buyer_id, seller_id,
    option_type, option_name, idea_title,
    amount_eur, commission_eur,
  } = session.metadata ?? {};

  // Validação básica de metadata
  if (!idea_id || !buyer_id || !seller_id || !amount_eur) {
    console.error('[webhook] Metadata incompleta na session:', session.id);
    return;
  }

  const amountEur     = parseFloat(amount_eur);
  const commissionEur = parseFloat(commission_eur ?? 0);
  const sellerNetEur  = Math.round((amountEur - commissionEur) * 100) / 100;
  const sellerNetCents = Math.round(sellerNetEur * 100);

  console.log(`[webhook] Compra: ideia=${idea_id} comprador=${buyer_id} valor=€${amountEur}`);

  // 1. Registar compra (idempotente via UNIQUE stripe_session_id)
  try {
    await supabaseInsert('purchases', {
      idea_id,
      buyer_id,
      seller_id,
      amount_eur:         amountEur,
      commission_eur:     commissionEur,
      option_type:        option_type ?? 'unknown',
      stripe_session_id:  session.id,
      status:             'completed',
    });
  } catch (e) {
    // Duplicado = webhook repetido, ignorar silenciosamente
    if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
      console.log('[webhook] Sessão já processada:', session.id);
      return;
    }
    throw e;
  }

  // 2. Incrementar sales_count da ideia
  await supabaseRpc('increment_idea_sales', { idea_uuid: idea_id });

  // 3. Creditar carteira do vendedor (valor líquido = total - comissão)
  await supabaseRpc('credit_wallet', {
    user_uuid:   seller_id,
    amount_cents: sellerNetCents,
    description: `Venda: ${option_name ?? option_type}`,
    ref_uuid:    idea_id,
  });

  // 4. Acumular pontos de loyalty do vendedor (€10 = 1 ponto, valor bruto da venda)
  const pointsEarned = Math.floor(amountEur / 10);
  if (pointsEarned > 0) {
    await supabaseRpc('add_loyalty_points', {
      user_uuid:     seller_id,
      points_to_add: pointsEarned,
    });
    console.log(`[webhook] Loyalty: +${pointsEarned} pontos → vendedor=${seller_id}`);
  }

  // 5. Email de confirmação ao comprador
  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  await sendPurchaseEmail(buyerEmail, idea_title ?? idea_id, option_name ?? option_type, amountEur);

  console.log(`[webhook] ✓ Processado. Vendedor recebe €${sellerNetEur} | Loyalty +${pointsEarned}pts`);
}

// ── Endpoint principal ────────────────────────────────────────
export default async (req) => {
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405 });

  // Ler body como texto (necessário para verificar assinatura)
  const rawBody   = await req.text();
  const sigHeader = req.headers.get('stripe-signature') ?? '';

  if (!verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET)) {
    console.error('[webhook] Assinatura inválida');
    return new Response('Invalid signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      // Adicionar outros eventos aqui conforme necessário:
      // case 'charge.dispute.created': ...
      // case 'payment_intent.payment_failed': ...
      default:
        // Ignorar eventos não tratados (Stripe envia muitos)
        break;
    }
  } catch (e) {
    console.error('[webhook] Erro ao processar evento:', e.message);
    // Devolver 500 faz o Stripe retentar o webhook
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
};
