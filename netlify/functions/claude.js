export const config = { path: '/api/claude' };

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { prompt, type = 'general' } = body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const systemPrompts = {
    publish: `És um assistente criativo do marketplace Catch This Idea.
O teu trabalho é ajudar vendedores a escrever descrições apelativas para as suas ideias criativas.
Responde sempre em Português de Portugal.
Sê conciso, entusiasta e profissional.`,

    category: `És um assistente de categorização do marketplace Catch This Idea.
Analisa a ideia descrita e devolve um JSON com:
- "category": uma de [Slogans, Nomes, Apps, Negócios, Design, Receitas, Histórias]
- "price": preço sugerido em euros (número inteiro entre 10 e 500)
- "reason": justificação breve em Português de Portugal
Responde APENAS com o JSON, sem markdown.`,

    support: `És o assistente de suporte do Catch This Idea, um marketplace de ideias criativas.
Ajuda compradores e vendedores com dúvidas sobre a plataforma.
Responde sempre em Português de Portugal, de forma simpática e clara.`,

    general: `És o assistente do Catch This Idea, um marketplace de ideias criativas.
Responde sempre em Português de Portugal.`,
  };

  const systemPrompt = systemPrompts[type] ?? systemPrompts.general;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt.trim() }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: err.error?.message ?? 'API error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';

  return new Response(JSON.stringify({ result: text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
