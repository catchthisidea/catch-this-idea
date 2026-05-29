/**
 * _moloni.js — Helper interno para a API do Moloni (faturação portuguesa)
 *
 * Utilização (apenas em outros ficheiros .js — não é um endpoint):
 *   import { createCommissionInvoice } from './_moloni.js';
 *
 * Variáveis de ambiente necessárias (Netlify):
 *   MOLONI_CLIENT_ID        — Client ID da app criada em moloni.pt/developers
 *   MOLONI_CLIENT_SECRET    — Client Secret da app
 *   MOLONI_USERNAME         — Email/username da conta Moloni
 *   MOLONI_PASSWORD         — Password da conta Moloni
 *   MOLONI_COMPANY_ID       — ID numérico da empresa (ver: Conta → Empresa)
 *   MOLONI_DOCUMENT_SET_ID  — ID da série de faturas (criar em: Faturação → Séries)
 *   MOLONI_TAX_ID           — ID do IVA 23% (ver: Configuração → Impostos). 0 = isento.
 *
 * Referência da API: https://www.moloni.pt/dev/
 *
 * Sobre a fatura de comissão:
 *   A CTI emite uma fatura AO vendedor pelo serviço de intermediação (comissão).
 *   A fatura inclui: descrição da ideia vendida, valor da comissão, e o IVA aplicável.
 *   O vendedor é criado/encontrado no Moloni por email.
 */

const MOLONI_BASE          = 'https://api.moloni.pt/v1';
const MOLONI_CLIENT_ID     = process.env.MOLONI_CLIENT_ID     ?? '';
const MOLONI_CLIENT_SECRET = process.env.MOLONI_CLIENT_SECRET ?? '';
const MOLONI_USERNAME      = process.env.MOLONI_USERNAME      ?? '';
const MOLONI_PASSWORD      = process.env.MOLONI_PASSWORD      ?? '';
const MOLONI_COMPANY_ID    = Number(process.env.MOLONI_COMPANY_ID    ?? 0);
const MOLONI_DOC_SET_ID    = Number(process.env.MOLONI_DOCUMENT_SET_ID ?? 0);
const MOLONI_TAX_ID        = Number(process.env.MOLONI_TAX_ID ?? 0); // 0 = isento de IVA

// ── Cache do token (válido enquanto a função estiver warm) ────
// O token Moloni expira em 1 hora; renovamos 60s antes.
let _tokenCache = null; // { access_token: string, expires_at: number }

async function getAccessToken() {
  if (_tokenCache && Date.now() < _tokenCache.expires_at) {
    return _tokenCache.access_token;
  }

  const res = await fetch(`${MOLONI_BASE}/grant/`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'password',
      client_id:     MOLONI_CLIENT_ID,
      client_secret: MOLONI_CLIENT_SECRET,
      username:      MOLONI_USERNAME,
      password:      MOLONI_PASSWORD,
      json:          '1',
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Moloni auth: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('Moloni auth: sem access_token na resposta');

  const expiresIn = data.expires_in ?? 3600;
  _tokenCache = {
    access_token: data.access_token,
    expires_at:   Date.now() + (expiresIn - 60) * 1000,
  };

  return _tokenCache.access_token;
}

// ── Helper de chamadas à API Moloni ──────────────────────────
async function moloniPost(endpoint, payload) {
  const token = await getAccessToken();
  const res = await fetch(`${MOLONI_BASE}/${endpoint}/`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ company_id: MOLONI_COMPANY_ID, ...payload }),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`Moloni [${endpoint}]: HTTP ${res.status} — ${String(text).slice(0, 300)}`);
  }

  return data;
}

/* ── Gestão de clientes ──────────────────────────────────────
 *
 * A Moloni usa "clientes" para os destinatários das faturas.
 * Tentamos encontrar o vendedor pelo email antes de criar.
 */

async function findClientByEmail(email) {
  try {
    const data = await moloniPost('clients/getBySearch', {
      search: email,
      qty:    5,
      offset: 0,
    });
    if (!Array.isArray(data)) return null;
    return data.find(c => (c.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
  } catch {
    return null; // Ignorar erro na pesquisa — tentará criar
  }
}

async function createClient(email, name) {
  const data = await moloniPost('clients/insert', {
    name:                name?.trim() || email.split('@')[0],
    email,
    country_id:          1,            // Portugal
    vat:                 '999999990',  // NIF genérico (consumidor final PT)
                                       // Actualizar se o vendedor fornecer o seu NIF
    maturity_date_id:    1,            // Pronto pagamento
    payment_method_id:   1,            // Transferência bancária (padrão)
    payment_day:         0,
    discount:            0,
    credit_limit:        0,
  });

  if (!data?.client_id) {
    throw new Error(`Moloni createClient: sem client_id — ${JSON.stringify(data)}`);
  }
  return data.client_id;
}

async function getOrCreateClient(email, name) {
  const existing = await findClientByEmail(email);
  if (existing?.client_id) return Number(existing.client_id);
  return createClient(email, name);
}

/* ── Emissão de faturas ──────────────────────────────────────
 *
 * Emite uma fatura de comissão da CTI ao vendedor.
 *
 * A fatura documenta:
 *   • Serviço: intermediação de venda de ideia criativa
 *   • Valor:   comissão calculada pelo tier de loyalty do vendedor
 *   • IVA:     conforme MOLONI_TAX_ID (23% padrão ou isento)
 */

/**
 * @param {object}  opts
 * @param {string}  opts.sellerEmail    — email do vendedor (cliente na fatura)
 * @param {string}  opts.sellerName     — nome do vendedor
 * @param {number}  opts.commissionEur  — comissão em euros (ex: 0.50)
 * @param {string}  opts.ideaTitle      — título da ideia vendida
 * @param {string}  opts.purchaseId     — UUID da compra (referência interna)
 * @returns {Promise<{ success: boolean, invoice_id?: number, error?: string }>}
 */
export async function createCommissionInvoice({ sellerEmail, sellerName, commissionEur, ideaTitle, purchaseId }) {
  // Verificar configuração mínima
  if (!MOLONI_CLIENT_ID || !MOLONI_COMPANY_ID || !MOLONI_DOC_SET_ID) {
    console.warn('[moloni] Variáveis de ambiente em falta (MOLONI_*) — faturação ignorada');
    return { success: false, error: 'moloni_not_configured' };
  }

  if (!sellerEmail || commissionEur <= 0) {
    return { success: false, error: 'dados_insuficientes' };
  }

  try {
    // 1. Obter ou criar cliente no Moloni
    const clientId = await getOrCreateClient(sellerEmail, sellerName);

    // 2. Preparar data e vencimento (pronto pagamento = mesmo dia)
    const today   = new Date();
    const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

    // 3. Linha de produto (serviço de intermediação)
    const taxes   = MOLONI_TAX_ID
      ? [{ tax_id: MOLONI_TAX_ID, value: 23, order: 0, cumulative: 0 }]
      : [];

    const product = {
      product_id: 0,               // 0 = linha ad-hoc (sem produto pré-criado no Moloni)
      name:       'Comissão de intermediação de venda',
      summary:    `Ideia: "${ideaTitle.slice(0, 150)}"`,
      code:       'COM',
      price:      commissionEur,
      qty:        1,
      discount:   0,
      order:      0,
      unit_id:    0,               // unidade genérica
      subtotal:   commissionEur,
      taxes,
      type:       2,               // 2 = serviço
      exempt_vat: MOLONI_TAX_ID ? 0 : 1,
    };

    // 4. Criar a fatura no Moloni
    const invoice = await moloniPost('invoices/insert', {
      document_set_id: MOLONI_DOC_SET_ID,
      client_id:       clientId,
      date:            dateStr,
      expiration_date: dateStr,          // pronto pagamento
      financial_discount: 0,
      our_reference:   purchaseId.slice(0, 30), // referência interna CTI
      your_reference:  '',
      notes:           `Serviço de intermediação — Catch This Idea`,
      status:          1,                // 1 = fatura finalizada (emitida)
      send_email:      0,                // CTI trata do envio de emails (não o Moloni)
      products:        [product],
    });

    // A API do Moloni devolve document_id ou invoice_id consoante a versão
    const invoiceId = invoice?.document_id ?? invoice?.invoice_id ?? null;

    console.log(`[moloni] ✓ Fatura emitida — id=${invoiceId} | €${commissionEur} | ${sellerEmail}`);
    return { success: true, invoice_id: invoiceId };

  } catch (e) {
    // Não bloquear o fluxo de venda por erro de faturação
    console.error(`[moloni] ✗ Erro ao emitir fatura para ${sellerEmail}:`, e.message);
    return { success: false, error: e.message };
  }
}
