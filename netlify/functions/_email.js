/**
 * _email.js — Utilitário central de emails (Catch This Idea)
 *
 * Todas as notificações transacionais passam por aqui.
 * Importar apenas o necessário em cada função:
 *   import { sendEmail, emailIdeaSold } from './_email.js';
 *
 * Design: marca CTI — laranja #e86000, creme #fffaf4, Georgia (títulos), Helvetica (corpo)
 * Língua: Português de Portugal (PT)
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM          = 'Catch This Idea <noreply@catchthisidea.com>';
const SITE          = 'https://catchthisidea.com';

/* ════════════════════════════════════════════════════
   HELPERS INTERNOS
════════════════════════════════════════════════════ */

/** Escapa caracteres HTML */
function h(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Formata valor monetário */
function eur(n) {
  return `€${Number(n || 0).toFixed(2)}`;
}

/* ════════════════════════════════════════════════════
   LOYALTY TIERS
════════════════════════════════════════════════════ */

/**
 * Devolve informação do tier de loyalty dado os pontos.
 * Exportado para uso externo (webhook.js).
 */
export function getTierInfo(points) {
  const p = Number(points ?? 0);
  if (p >= 500) return { name: 'Mestre',       commission: '5%',  emoji: '🏆' };
  if (p >= 250) return { name: 'Especialista', commission: '6%',  emoji: '💎' };
  if (p >= 100) return { name: 'Autor',        commission: '7%',  emoji: '✨' };
  if (p >= 30)  return { name: 'Criador',      commission: '8%',  emoji: '🎨' };
  if (p >= 10)  return { name: 'Artesão',      commission: '9%',  emoji: '🔨' };
  return              { name: 'Faísca',        commission: '10%', emoji: '⚡' };
}

/* ════════════════════════════════════════════════════
   BLOCOS DE UI (strings HTML)
════════════════════════════════════════════════════ */

function elTitle(text) {
  return `<p style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#1a0f00;margin:0 0 14px;line-height:1.3">${text}</p>`;
}

function elBody(text) {
  return `<p style="font-size:15px;color:#7a6040;line-height:1.7;margin:0 0 14px">${text}</p>`;
}

function elSmall(text) {
  return `<p style="font-size:12px;color:#b09878;margin:8px 0 0;line-height:1.5">${text}</p>`;
}

function elBtn(text, url) {
  return `<div style="text-align:center;margin:26px 0">
    <a href="${url}" style="display:inline-block;background:#e86000;color:#fff;padding:14px 36px;border-radius:40px;font-size:15px;font-weight:600;text-decoration:none;font-family:'Helvetica Neue',Arial,sans-serif">${h(text)}</a>
  </div>`;
}

function elInfoBox(content) {
  return `<div style="background:#fff0e0;border:1px solid #f5d0a8;border-radius:8px;padding:16px 20px;margin:18px 0">${content}</div>`;
}

function elWarnBox(text) {
  return `<div style="background:#fff8e1;border-left:4px solid #f0b800;border-radius:0 6px 6px 0;padding:12px 16px;margin:18px 0">
    <p style="margin:0;font-size:13px;color:#7a5800;line-height:1.5">${text}</p>
  </div>`;
}

function elDangerBox(text) {
  return `<div style="background:#fdf0f0;border-left:4px solid #d43f3f;border-radius:0 6px 6px 0;padding:12px 16px;margin:18px 0">
    <p style="margin:0;font-size:13px;color:#7a2020;line-height:1.5">${text}</p>
  </div>`;
}

function elSuccessBox(text) {
  return `<div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 6px 6px 0;padding:12px 16px;margin:18px 0">
    <p style="margin:0;font-size:13px;color:#166534;line-height:1.5">${text}</p>
  </div>`;
}

function elDivider() {
  return `<hr style="border:none;border-top:1px solid #ddd0b8;margin:22px 0">`;
}

/** Estrelas em UTF-8 */
function starStr(n) {
  const s = Math.max(1, Math.min(5, Number(n ?? 3)));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}

/* ════════════════════════════════════════════════════
   TEMPLATE BASE HTML
════════════════════════════════════════════════════ */

/**
 * Envolve o conteúdo no template base da marca.
 * @param {string} bodyContent - HTML do corpo do email
 * @param {object} opts
 * @param {string} [opts.preheader] - Texto de pré-visualização (oculto)
 */
function base(bodyContent, { preheader = '' } = {}) {
  const year = new Date().getFullYear();
  const pre  = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f5ede0;mso-hide:all">${h(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:24px 16px;background:#f5ede0;font-family:'Helvetica Neue',Arial,sans-serif">
  ${pre}
  <div style="max-width:540px;margin:0 auto;background:#fffaf4;border:1px solid #ddd0b8;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(26,15,0,.08)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#e86000 0%,#f07800 100%);padding:22px 32px">
      <span style="font-family:Georgia,'Times New Roman',serif;font-size:21px;color:#fff;font-style:italic;letter-spacing:.5px">Catch · This · Idea</span>
    </div>
    <!-- Body -->
    <div style="padding:32px 32px 26px">
      ${bodyContent}
    </div>
    <!-- Footer -->
    <div style="background:#f5ede0;border-top:1px solid #ddd0b8;padding:16px 32px;text-align:center">
      <p style="font-size:11px;color:#b09878;margin:0 0 4px">
        © ${year} Catch This Idea ·
        <a href="${SITE}" style="color:#b09878;text-decoration:none">catchthisidea.com</a>
      </p>
      <p style="font-size:11px;color:#b09878;margin:0">
        Dúvidas? <a href="${SITE}/help.html" style="color:#e86000;text-decoration:none">Centro de ajuda</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/* ════════════════════════════════════════════════════
   SENDER
════════════════════════════════════════════════════ */

/**
 * Envia um email via Resend.
 * @param {string} to      - Endereço de destino
 * @param {string} subject - Assunto
 * @param {string} html    - Corpo HTML
 * @returns {Promise<boolean>} true se enviado com sucesso
 */
export async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to || !subject || !html) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body:    JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[email] Resend ${res.status}:`, err.message ?? JSON.stringify(err).slice(0, 200));
    }
    return res.ok;
  } catch (e) {
    console.error('[email] sendEmail failed:', e.message);
    return false;
  }
}

/* ════════════════════════════════════════════════════
   TEMPLATES — cada função devolve { subject, html }
════════════════════════════════════════════════════ */

/* ── 1. Venda concluída → vendedor ───────────────────────────── */
export function emailIdeaSold(ideaTitle, optionName, netEur, buyerName) {
  const content =
    elTitle('💰 Vendeste uma ideia!') +
    elBody(`A tua ideia foi adquirida e o valor líquido já está disponível na tua carteira.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia vendida</p>
      <p style="margin:0 0 12px;font-size:17px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#7a6040">Modalidade: <strong>${h(optionName)}</strong></p>
      ${buyerName ? `<p style="margin:0 0 4px;font-size:13px;color:#7a6040">Comprador: <strong>${h(buyerName)}</strong></p>` : ''}
      <p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#e86000">Ganhos líquidos: ${eur(netEur)}</p>
    `) +
    elBtn('Ver carteira', `${SITE}/perfil.html#wallet`) +
    elSmall('O valor já está disponível para levantar a qualquer momento.');

  return {
    subject: `💰 Ideia vendida — ${ideaTitle || 'Catch This Idea'}`,
    html:    base(content, { preheader: `Parabéns! A tua ideia "${ideaTitle}" foi vendida por ${eur(netEur)} (líquido).` }),
  };
}

/* ── 2. Reembolso processado → comprador ─────────────────────── */
export function emailRefundBuyer(ideaTitle, amountEur) {
  const content =
    elTitle('↩ Reembolso processado') +
    elBody('O teu reembolso foi processado com sucesso. O valor será devolvido ao método de pagamento original em 5–10 dias úteis.') +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Compra reembolsada</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
      <p style="margin:0;font-size:14px;color:#7a6040">Valor devolvido: <strong style="color:#e86000">${eur(amountEur)}</strong></p>
    `) +
    elSmall('Se tiveres dúvidas, contacta-nos respondendo a este email.');

  return {
    subject: `↩ Reembolso de ${eur(amountEur)} processado`,
    html:    base(content, { preheader: `O reembolso de ${eur(amountEur)} referente a "${ideaTitle}" foi processado.` }),
  };
}

/* ── 3. Reembolso processado → vendedor ─────────────────────── */
export function emailRefundSeller(ideaTitle, amountEur) {
  const content =
    elTitle('⚠ Um reembolso foi emitido') +
    elBody('A equipa da Catch This Idea processou um reembolso referente a uma venda tua. O montante correspondente foi debitado da tua carteira.') +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia em causa</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
      <p style="margin:0;font-size:14px;color:#7a6040">Valor debitado: <strong>${eur(amountEur)}</strong></p>
    `) +
    elBody('Se tiveres dúvidas sobre este reembolso, contacta o suporte respondendo a este email.') +
    elSmall('Os reembolsos são processados quando o comprador reporta um problema válido com a compra.');

  return {
    subject: `⚠ Reembolso emitido — ${ideaTitle || 'Catch This Idea'}`,
    html:    base(content, { preheader: `Um reembolso de ${eur(amountEur)} foi emitido para a tua ideia "${ideaTitle}".` }),
  };
}

/* ── 4. Ideia aprovada → vendedor ────────────────────────────── */
export function emailIdeaApproved(sellerName, ideaTitle) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('✅ A tua ideia foi aprovada!') +
    elBody(`Olá${name}! A nossa equipa analisou a tua submissão e a ideia está agora <strong style="color:#1a0f00">publicada e visível no marketplace</strong>.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia aprovada</p>
      <p style="margin:0;font-size:17px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
    `) +
    elSuccessBox('Dica: partilha o link nas redes sociais para aumentar a visibilidade e as hipóteses de venda!') +
    elBtn('Ver no marketplace', SITE) +
    elSmall('Obrigado por contribuíres com ideias de qualidade.');

  return {
    subject: `✅ Ideia aprovada — ${ideaTitle || 'Catch This Idea'}`,
    html:    base(content, { preheader: `"${ideaTitle}" foi aprovada e está agora disponível no marketplace.` }),
  };
}

/* ── 5. Ideia rejeitada → vendedor ───────────────────────────── */
export function emailIdeaRejected(sellerName, ideaTitle, reason) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('❌ A tua ideia não foi aprovada') +
    elBody(`Olá${name}! Após análise, a tua submissão não cumpriu os critérios de publicação do marketplace.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia submetida</p>
      <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040">Motivo da rejeição:</p>
      <p style="margin:0;font-size:14px;color:#1a0f00;font-style:italic">"${h(reason)}"</p>
    `) +
    elBody('Podes rever a ideia com base neste feedback e submetê-la novamente após as correções.') +
    elBtn('Submeter nova ideia', `${SITE}/index-app.html`) +
    elSmall('Se acreditas que se trata de um erro, contacta o suporte respondendo a este email.');

  return {
    subject: `❌ Ideia não aprovada — ${ideaTitle || 'Catch This Idea'}`,
    html:    base(content, { preheader: `A tua ideia "${ideaTitle}" não foi aprovada. Vê o motivo e como corrigir.` }),
  };
}

/* ── 6. 2ª rejeição — aviso ──────────────────────────────────── */
export function emailSecondRejectionWarning(sellerName, ideaTitle) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('⚠ Atenção: 2ª rejeição') +
    elBody(`Olá${name}! Esta é a segunda ideia que submetes sem cumprir os critérios de qualidade do marketplace.`) +
    elWarnBox(`<strong>Aviso importante:</strong> Uma terceira rejeição resultará na <strong>suspensão automática da tua conta</strong>. Por favor, lê as nossas diretrizes antes de submeter novamente.`) +
    (ideaTitle
      ? elInfoBox(`<p style="margin:0;font-size:13px;color:#7a6040">Última ideia rejeitada: <strong style="color:#1a0f00">${h(ideaTitle)}</strong></p>`)
      : '') +
    elBody('Queremos que tenhas sucesso na plataforma. Estamos aqui para ajudar — responde a este email se tiveres dúvidas sobre como melhorar as tuas ideias.') +
    elBtn('Ler diretrizes de qualidade', `${SITE}/help.html`) +
    elSmall('Obrigado pela compreensão.');

  return {
    subject: '⚠ Aviso: 2ª ideia rejeitada — Catch This Idea',
    html:    base(content, { preheader: 'Aviso importante: mais uma rejeição pode levar à suspensão da tua conta.' }),
  };
}

/* ── 7. Conta suspensa (automática) ──────────────────────────── */
export function emailAccountSuspended(sellerName) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('🚫 Conta suspensa temporariamente') +
    elBody(`Olá${name}! A tua conta foi suspensa temporariamente devido a múltiplas violações das diretrizes de publicação da Catch This Idea.`) +
    elDangerBox('Não podes submeter novas ideias enquanto a suspensão estiver ativa. As tuas ideias existentes permanecem visíveis.') +
    elBody('Podes contactar a nossa equipa de suporte para contestar esta decisão ou obter mais informações sobre como reativar a conta.') +
    elBtn('Contactar suporte', `${SITE}/help.html`) +
    elSmall('Se acreditas que se trata de um erro, responde a este email com a tua explicação.');

  return {
    subject: '🚫 Conta suspensa temporariamente — Catch This Idea',
    html:    base(content, { preheader: 'A tua conta na Catch This Idea foi suspensa temporariamente.' }),
  };
}

/* ── 8. Suspensão levantada ──────────────────────────────────── */
export function emailSuspensionLifted(sellerName) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('✅ Conta reativada!') +
    elBody(`Olá${name}! Boa notícia — a suspensão da tua conta foi levantada. Podes voltar a submeter ideias normalmente.`) +
    elSuccessBox('A tua conta está <strong>ativa</strong> e o contador de rejeições foi reposto a zero. Começa de novo!') +
    elBtn('Aceder ao marketplace', `${SITE}/index-app.html`) +
    elBody('Recorda-te de ler as nossas <a href="' + SITE + '/help.html" style="color:#e86000">diretrizes de publicação</a> para garantir que as tuas próximas ideias são aprovadas.') +
    elSmall('Bem-vindo(a) de volta à Catch This Idea.');

  return {
    subject: '✅ Suspensão levantada — Catch This Idea',
    html:    base(content, { preheader: 'A suspensão da tua conta foi levantada. Podes submeter ideias novamente!' }),
  };
}

/* ── 9. Conta banida permanentemente ─────────────────────────── */
export function emailAccountBanned(sellerName) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('🚫 Conta encerrada permanentemente') +
    elBody(`Olá${name}. Após revisão, a tua conta na Catch This Idea foi encerrada permanentemente por violações graves dos nossos Termos de Serviço.`) +
    elDangerBox('O acesso à plataforma foi revogado. Os teus dados serão tratados em conformidade com a nossa <a href="' + SITE + '/privacy.html" style="color:#7a2020">política de privacidade</a>.') +
    elBody('Se acreditas que esta decisão é um erro, podes recorrer através do email de suporte.') +
    elSmall(`Suporte: <a href="mailto:suporte@catchthisidea.com" style="color:#e86000">suporte@catchthisidea.com</a>`);

  return {
    subject: '🚫 Conta encerrada — Catch This Idea',
    html:    base(content, { preheader: 'A tua conta na Catch This Idea foi encerrada permanentemente.' }),
  };
}

/* ── 10. Boas-vindas (após confirmação de registo) ───────────── */
export function emailWelcome(name) {
  const displayName = name ? h(name) : 'criativo(a)';
  const content =
    elTitle(`🎉 Bem-vindo(a), ${displayName}!`) +
    elBody('A tua conta foi criada com sucesso. Confirma o teu email no link que acabámos de enviar e já podes começar a explorar o marketplace.') +
    elInfoBox(`
      <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#1a0f00">O que podes fazer na Catch This Idea:</p>
      <p style="margin:0 0 6px;font-size:13px;color:#7a6040">💡 <strong>Vender ideias</strong> — slogans, nomes, apps, negócios, receitas e mais</p>
      <p style="margin:0 0 6px;font-size:13px;color:#7a6040">🛒 <strong>Comprar ideias</strong> — licencia ou adquire exclusividade sobre conceitos prontos</p>
      <p style="margin:0;font-size:13px;color:#7a6040">🏆 <strong>Programa de fidelidade</strong> — comissão progressiva de 10% até 5%</p>
    `) +
    elBtn('Explorar o marketplace', SITE) +
    elSmall(`Dúvidas? Visita o nosso <a href="${SITE}/help.html" style="color:#e86000">centro de ajuda</a>.`);

  return {
    subject: '🎉 Bem-vindo(a) ao Catch This Idea!',
    html:    base(content, { preheader: 'Bem-vindo(a) ao marketplace de ideias criativas. Confirma o email e começa!' }),
  };
}

/* ── 11. Subida de tier de loyalty → vendedor ────────────────── */
export function emailTierUpgrade(sellerName, newPoints) {
  const tier    = getTierInfo(newPoints);
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle(`${tier.emoji} Subiste de nível!`) +
    elBody(`Olá${name}! Com <strong>${newPoints} pontos</strong> acumulados, atingiste um novo nível no programa de fidelidade.`) +
    elInfoBox(`
      <p style="margin:0 0 8px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Novo nível</p>
      <p style="margin:0 0 6px;font-size:24px;font-weight:700;color:#e86000">${tier.emoji} ${h(tier.name)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#7a6040">Comissão aplicada: <strong style="color:#1a0f00">${tier.commission}</strong></p>
      <p style="margin:0;font-size:13px;color:#7a6040">Pontos acumulados: <strong>${newPoints}</strong></p>
    `) +
    elBody('Quanto mais venderes, mais os teus pontos crescem e a tua comissão diminui. Continua assim!') +
    elBtn('Ver programa de fidelidade', `${SITE}/loyalty.html`) +
    elSmall('Os pontos acumulam-se ao longo da vida da conta e nunca expiram.');

  return {
    subject: `${tier.emoji} Novo nível de fidelidade: ${tier.name}!`,
    html:    base(content, { preheader: `Parabéns! Subiste para o nível ${tier.name} — comissão de ${tier.commission}.` }),
  };
}

/* ── 12. Ideia em destaque → vendedor ────────────────────────── */
export function emailIdeaFeatured(sellerName, ideaTitle) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('⭐ A tua ideia está em destaque!') +
    elBody(`Olá${name}! A nossa equipa editorial selecionou a tua ideia para destaque na página inicial do marketplace.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia em destaque</p>
      <p style="margin:0;font-size:17px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
    `) +
    elSuccessBox('As ideias em destaque têm maior visibilidade e tendem a receber mais visualizações e vendas. Aproveita!') +
    elBtn('Ver no marketplace', SITE) +
    elSmall('A seleção de ideias em destaque é feita pela equipa editorial da Catch This Idea.');

  return {
    subject: `⭐ A tua ideia está em destaque — ${ideaTitle || 'Catch This Idea'}`,
    html:    base(content, { preheader: `"${ideaTitle}" foi selecionada para a secção de destaque da página inicial!` }),
  };
}

/* ── 13. Nova avaliação recebida → vendedor ──────────────────── */
export function emailNewRating(sellerName, ideaTitle, stars, comment, buyerName) {
  const starsHtml = starStr(stars);
  const name      = sellerName ? `, ${h(sellerName)}` : '';
  const byLine    = buyerName ? ` · por <strong>${h(buyerName)}</strong>` : '';
  const content =
    elTitle('⭐ Nova avaliação recebida') +
    elBody(`Olá${name}! ${buyerName ? `<strong>${h(buyerName)}</strong>` : 'Um comprador'} avaliou a tua ideia.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia avaliada</p>
      <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
      <p style="margin:0 0 4px;font-size:22px;color:#f07800;letter-spacing:3px">${starsHtml}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#7a6040">${stars}/5 estrelas${byLine}</p>
      ${comment ? `${elDivider()}<p style="margin:0;font-size:13px;color:#1a0f00;font-style:italic;line-height:1.6">"${h(String(comment).slice(0, 300))}"</p>` : ''}
    `) +
    elBtn('Ver o meu perfil', `${SITE}/perfil.html`) +
    elSmall('As avaliações são públicas e ajudam a construir a tua reputação no marketplace.');

  return {
    subject: `${starsHtml} Nova avaliação — ${ideaTitle || 'Catch This Idea'}`,
    html:    base(content, { preheader: `${stars}/5 ★ — ${buyerName || 'Um comprador'} avaliou a tua ideia "${ideaTitle}".` }),
  };
}

/* ── 14. Milestone de visualizações → vendedor ───────────────── */
export function emailViewMilestone(sellerName, ideaTitle, views) {
  const emoji   = views >= 1000 ? '🚀' : views >= 500 ? '🌟' : views >= 100 ? '🎯' : views >= 50 ? '📈' : '👁';
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle(`${emoji} ${views.toLocaleString('pt-PT')} visualizações!`) +
    elBody(`Olá${name}! A tua ideia atingiu um novo marco: <strong style="color:#1a0f00">${views.toLocaleString('pt-PT')} visualizações</strong>.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia</p>
      <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
      <p style="margin:0;font-size:32px;font-weight:700;color:#e86000">${views.toLocaleString('pt-PT')} ${emoji}</p>
    `) +
    elBody('A tua ideia está a ganhar visibilidade! Cada visualização é um potencial comprador.') +
    elBtn('Ver no marketplace', SITE) +
    elSmall('Partilha o link nas redes sociais para acelerar ainda mais o crescimento.');

  return {
    subject: `${emoji} A tua ideia atingiu ${views.toLocaleString('pt-PT')} visualizações!`,
    html:    base(content, { preheader: `"${ideaTitle}" já tem ${views.toLocaleString('pt-PT')} visualizações. Continua a crescer!` }),
  };
}

/* ── 15. Resumo mensal → vendedor (cron) ─────────────────────── */
export function emailMonthlySummary(sellerName, month, salesCount, earningsEur, topIdeaTitle, loyaltyPoints) {
  const tier    = getTierInfo(loyaltyPoints ?? 0);
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const noSales = salesCount === 0;
  const content =
    elTitle(`📊 O teu resumo de ${h(month)}`) +
    elBody(`Olá${name}! Aqui está um resumo da tua atividade em <strong style="color:#1a0f00">${h(month)}</strong>:`) +
    elInfoBox(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td style="width:33%;text-align:center;padding:12px 8px;vertical-align:top">
            <p style="margin:0;font-size:28px;font-weight:700;color:#e86000">${salesCount}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#7a6040">venda${salesCount !== 1 ? 's' : ''}</p>
          </td>
          <td style="width:33%;text-align:center;padding:12px 8px;border-left:1px solid #f5d0a8;vertical-align:top">
            <p style="margin:0;font-size:22px;font-weight:700;color:#e86000">${eur(earningsEur)}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#7a6040">ganhos líquidos</p>
          </td>
          <td style="width:33%;text-align:center;padding:12px 8px;border-left:1px solid #f5d0a8;vertical-align:top">
            <p style="margin:0;font-size:18px;font-weight:700;color:#e86000">${tier.emoji} ${h(tier.name)}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#7a6040">${loyaltyPoints ?? 0} pontos</p>
          </td>
        </tr>
      </table>
      ${topIdeaTitle ? `<p style="margin:14px 0 0;font-size:13px;color:#7a6040;border-top:1px solid #f5d0a8;padding-top:12px">🏅 Ideia mais vendida: <strong style="color:#1a0f00">${h(topIdeaTitle)}</strong></p>` : ''}
    `) +
    (noSales
      ? elBody('Este mês não tiveste vendas. Experimenta melhorar as descrições das tuas ideias ou partilhá-las nas redes sociais!')
      : elBody('Continua assim! O programa de fidelidade recompensa os vendedores mais ativos com comissões progressivamente mais baixas.')
    ) +
    elBtn('Ver o meu perfil', `${SITE}/perfil.html`) +
    elSmall('Este resumo é enviado automaticamente no início de cada mês.');

  return {
    subject: `📊 O teu resumo de ${month} — Catch This Idea`,
    html:    base(content, { preheader: `Resumo de ${month}: ${salesCount} ${salesCount === 1 ? 'venda' : 'vendas'}, ${eur(earningsEur)} ganhos líquidos.` }),
  };
}

/* ── 16. Ideia inativa há 90 dias → vendedor (cron) ─────────── */
export function emailInactiveIdea(sellerName, ideaTitle, daysSince) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('💤 A tua ideia pode precisar de atenção') +
    elBody(`Olá${name}! A tua ideia está publicada há mais de ${daysSince} dias sem nenhuma venda.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Ideia sem vendas</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#1a0f00">${h(ideaTitle)}</p>
    `) +
    elBody('Algumas dicas para aumentar as hipóteses de venda:') +
    `<ul style="color:#7a6040;font-size:14px;line-height:2;margin:0 0 16px;padding-left:20px">
      <li>Melhora o título com palavras-chave relevantes</li>
      <li>Expande a descrição com exemplos concretos de uso</li>
      <li>Adiciona imagens ou mockups que ilustrem a ideia</li>
      <li>Revê o preço — compara com ideias similares</li>
      <li>Partilha o link da ideia nas redes sociais</li>
    </ul>` +
    elBtn('Editar a minha ideia', `${SITE}/index-app.html`) +
    elSmall('Se não queres continuar a vender esta ideia, podes despublicá-la a qualquer momento no teu perfil.');

  return {
    subject: `💤 A tua ideia está parada há ${daysSince} dias — Catch This Idea`,
    html:    base(content, { preheader: `"${ideaTitle}" está publicada há mais de ${daysSince} dias sem vendas. Vê como melhorar.` }),
  };
}

/* ── 17. Saldo disponível para levantar (cron) ───────────────── */
export function emailWalletReminder(sellerName, balanceEur) {
  const name    = sellerName ? `, ${h(sellerName)}` : '';
  const content =
    elTitle('💰 Tens saldo disponível para levantar') +
    elBody(`Olá${name}! Só queríamos lembrar que tens <strong style="color:#e86000;font-size:18px">${eur(balanceEur)}</strong> disponíveis na tua carteira Catch This Idea.`) +
    elInfoBox(`
      <p style="margin:0 0 4px;font-size:12px;color:#7a6040;text-transform:uppercase;letter-spacing:.5px">Saldo disponível</p>
      <p style="margin:0;font-size:32px;font-weight:700;color:#e86000">${eur(balanceEur)}</p>
    `) +
    elBody('O teu saldo não expira — podes levantá-lo a qualquer momento através do teu perfil.') +
    elBtn('Levantar saldo', `${SITE}/perfil.html#wallet`) +
    elSmall('Os levantamentos são processados em 1–3 dias úteis após o pedido.');

  return {
    subject: `💰 Tens ${eur(balanceEur)} disponíveis para levantar`,
    html:    base(content, { preheader: `Lembrete: tens ${eur(balanceEur)} disponíveis na tua carteira Catch This Idea.` }),
  };
}
