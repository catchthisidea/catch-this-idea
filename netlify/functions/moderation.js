/**
 * moderation.js — Agente de moderação de conteúdo (Claude Haiku)
 *
 * Uso interno: chamado por ideas.js após submissão de ideia.
 * Uso admin:   POST /api/moderation  { idea_id, admin_token }  → re-modera manualmente.
 *
 * Decisões possíveis:
 *   "approved"      → auto-publica (confiança >= 0.85, sem flags graves)
 *   "needs_review"  → fica pending para revisão humana
 *   "flagged"       → conteúdo claramente violador, revisão humana obrigatória
 */

export const config = { path: '/api/moderation' };

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL   = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_SVC   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET   = process.env.MODERATION_ADMIN_SECRET; // variável opcional para admin

const ALLOWED_ORIGINS = ['https://catchthisidea.com', 'https://catchthisidea.netlify.app'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

const svc = () => ({
  'apikey':        SUPABASE_SVC,
  'Authorization': `Bearer ${SUPABASE_SVC}`,
  'Content-Type':  'application/json',
});

// ── Prompt de moderação ──────────────────────────────────────
const MODERATION_PROMPT = (idea) => `You are a strict content moderation agent for "Catch This Idea", a marketplace for creative ideas (slogans, app concepts, business plans, recipes, designs, etc.).

Analyze this user submission for Terms of Service compliance.

SUBMISSION:
Title: ${idea.title_pt || ''}
Description: ${idea.desc_pt || '(none)'}
Category: ${idea.category || ''}

CHECK FOR (in order of severity):
1. ILLEGAL content — crime promotion, weapons, drugs, CSAM, terrorism, fraud, money laundering
2. HARMFUL content — violence, self-harm, hate speech (racial/religious/gender)
3. ADULT content — sexual, explicit, adult-only
4. CODE INJECTION — HTML tags, <script>, javascript:, SQL keywords as content (SELECT/DROP/INSERT), base64 encoded scripts
5. PERSONAL DATA — real people's addresses, phone numbers, government IDs
6. IP VIOLATIONS — obvious, verbatim copy of famous brand slogans, trademarked names used as the idea itself
7. SPAM / GIBBERISH — random characters, obvious filler with no creative value

IMPORTANT: Creative ideas about legal topics (tech startups, food, design, marketing, etc.) should be APPROVED even if they mention sensitive industries. Only reject or flag if content itself is problematic.

Respond with ONLY valid JSON, no markdown fences, no extra text:
{
  "decision": "approved" | "needs_review" | "flagged",
  "confidence": 0.0,
  "reason": "One sentence in English",
  "flags": []
}

Decision rules:
- "approved": Legitimate creative idea, no violations found. Use when confidence >= 0.82.
- "needs_review": Borderline case, unusual content, or confidence < 0.82. Human should verify.
- "flagged": Clear, obvious violation of categories 1-4 above. Do NOT flag for minor/ambiguous issues.`;

// ── Função principal de análise ──────────────────────────────
export async function analyzeIdea(idea) {
  if (!ANTHROPIC_KEY) {
    console.warn('[moderation] ANTHROPIC_API_KEY not set — auto-approving');
    return { decision: 'approved', confidence: 1.0, reason: 'No API key configured', flags: [] };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens: 256,
      temperature: 0,
      messages:   [{ role: 'user', content: MODERATION_PROMPT(idea) }],
    }),
  });

  if (!res.ok) {
    console.error('[moderation] Anthropic error', res.status);
    return { decision: 'needs_review', confidence: 0.5, reason: 'API error — queued for human review', flags: [] };
  }

  const data  = await res.json();
  const text  = (data.content?.[0]?.text ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

  try {
    const parsed = JSON.parse(text);
    // Sanity check the response
    if (!['approved', 'needs_review', 'flagged'].includes(parsed.decision)) {
      parsed.decision = 'needs_review';
    }
    parsed.confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
    parsed.flags      = Array.isArray(parsed.flags) ? parsed.flags.slice(0, 5) : [];
    parsed.reason     = String(parsed.reason || '').slice(0, 300);
    return parsed;
  } catch (e) {
    console.error('[moderation] JSON parse error:', text);
    return { decision: 'needs_review', confidence: 0.5, reason: 'Parsing error — queued for human review', flags: [] };
  }
}

// ── Aplicar decisão à ideia no Supabase ──────────────────────
export async function applyDecision(ideaId, result) {
  const { decision, reason } = result;

  // Map moderation decision to DB columns
  // status (seller-facing): only set to 'active' if approved
  // moderation_status (internal): tracks the moderation state
  const update = {
    moderation_status: decision === 'approved' ? 'approved'
                     : decision === 'flagged'  ? 'flagged'
                     : 'pending',
    moderation_reason: reason,
    moderated_at:      new Date().toISOString(),
    moderated_by:      'ai',
    // Only make publicly visible if approved
    ...(decision === 'approved' ? { status: 'active' } : {}),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${ideaId}`, {
    method:  'PATCH',
    headers: { ...svc(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(update),
  });

  if (!res.ok) {
    console.error('[moderation] Supabase update error', res.status);
  }

  return update;
}

// ── HTTP handler (admin re-moderation) ──────────────────────
export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  // Admin-only endpoint — require secret token
  const auth = req.headers.get('authorization') ?? '';
  if (!ADMIN_SECRET || auth !== `Bearer ${ADMIN_SECRET}`) {
    return json({ error: 'Não autorizado' }, 401, origin);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, origin); }

  const { idea_id } = body;
  if (!idea_id) return json({ error: 'idea_id é obrigatório' }, 400, origin);

  // Fetch idea from Supabase
  const ideaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ideas?id=eq.${idea_id}&select=title_pt,desc_pt,category`,
    { headers: svc() }
  );
  if (!ideaRes.ok) return json({ error: 'Erro ao carregar ideia' }, 502, origin);
  const ideas = await ideaRes.json();
  if (!ideas.length) return json({ error: 'Ideia não encontrada' }, 404, origin);

  const result = await analyzeIdea(ideas[0]);
  const update = await applyDecision(idea_id, result);

  return json({ idea_id, moderation: result, applied: update }, 200, origin);
};
