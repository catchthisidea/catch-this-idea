/**
 * upload.js — Upload seguro de imagens e documentos
 *
 * POST /api/upload  (multipart/form-data, campo "image" ou "document")
 *
 * Tipos aceites:
 *   Imagens  → JPEG, PNG, WebP  → bucket público  "idea-images"  (máx 5 MB)
 *   Documentos → PDF            → bucket privado  "idea-docs"    (máx 10 MB)
 *
 * Segurança:
 *  1. Autenticação obrigatória (JWT Supabase)
 *  2. Validação de magic bytes (assinatura real do ficheiro)
 *  3. Tamanho máximo por tipo
 *  4. Renomeação para UUID (nunca usa o nome original)
 *  5. Rate limiting: máx 10 uploads por IP por hora
 *
 * Resposta:
 *   Imagens   → { kind:'image',    url: <public CDN URL>, path, mime, size }
 *   Documentos → { kind:'document', url: null, path: <storage path>, mime, size }
 *                 (URL pública não existe — usar /api/download para signed URL)
 */

export const config = { path: '/api/upload' };

const SUPABASE_URL    = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON   = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SVC    = process.env.SUPABASE_SERVICE_KEY;

const BUCKET_IMAGES   = 'idea-images';   // público — CDN
const BUCKET_DOCS     = 'idea-docs';     // privado — signed URLs

const MAX_IMAGE_BYTES = 5  * 1024 * 1024;  // 5 MB
const MAX_DOC_BYTES   = 10 * 1024 * 1024;  // 10 MB

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

// ── Magic bytes por tipo ──────────────────────────────────────
const MAGIC = {
  jpeg: { mime: 'image/jpeg',       ext: 'jpg', bucket: BUCKET_IMAGES, maxSize: MAX_IMAGE_BYTES, kind: 'image' },
  png:  { mime: 'image/png',        ext: 'png', bucket: BUCKET_IMAGES, maxSize: MAX_IMAGE_BYTES, kind: 'image' },
  webp: { mime: 'image/webp',       ext: 'webp',bucket: BUCKET_IMAGES, maxSize: MAX_IMAGE_BYTES, kind: 'image' },
  pdf:  { mime: 'application/pdf',  ext: 'pdf', bucket: BUCKET_DOCS,   maxSize: MAX_DOC_BYTES,   kind: 'document' },
};

function detectType(buffer) {
  const b = new Uint8Array(buffer.slice(0, 12));

  // JPEG: FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)
    return MAGIC.jpeg;

  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47)
    return MAGIC.png;

  // WebP: RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return MAGIC.webp;

  // PDF: %PDF
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)
    return MAGIC.pdf;

  return null; // tipo não permitido
}

// ── Rate limiting ─────────────────────────────────────────────
const uploadLog = new Map();
function checkRateLimit(ip) {
  const now    = Date.now();
  const window = 60 * 60 * 1000;
  const max    = 10;
  const rec    = uploadLog.get(ip);
  if (!rec || now - rec.first > window) { uploadLog.set(ip, { first: now, count: 1 }); return true; }
  rec.count++;
  return rec.count <= max;
}

// ── UUID simples ──────────────────────────────────────────────
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export default async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405, origin);

  // ── 1. Autenticação ─────────────────────────────────────────
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
  if (!token) return json({ error: 'Autenticação obrigatória' }, 401, origin);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: 'Sessão inválida' }, 401, origin);
  const user = await userRes.json();

  // ── 2. Rate limiting ────────────────────────────────────────
  const ip = req.headers.get('x-nf-client-connection-ip')
          ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          ?? 'unknown';
  if (!checkRateLimit(ip))
    return json({ error: 'Limite de uploads atingido. Tenta novamente em 1 hora.' }, 429, origin);

  // ── 3. Parse multipart ──────────────────────────────────────
  let formData;
  try { formData = await req.formData(); }
  catch { return json({ error: 'Pedido inválido — esperado multipart/form-data' }, 400, origin); }

  // Aceita campo "image" (imagens) ou "document" (PDFs)
  const file = formData.get('image') ?? formData.get('document');
  if (!file || typeof file === 'string')
    return json({ error: 'Campo "image" ou "document" é obrigatório' }, 400, origin);

  // ── 4. Ler buffer e detectar tipo ───────────────────────────
  const buffer = await file.arrayBuffer();

  if (buffer.byteLength < 100)
    return json({ error: 'Ficheiro inválido ou corrompido.' }, 400, origin);

  const detectedType = detectType(buffer);
  if (!detectedType)
    return json({ error: 'Tipo não permitido. Aceites: JPEG, PNG, WebP, PDF.' }, 415, origin);

  // ── 5. Verificar tamanho (após detetar tipo) ────────────────
  if (buffer.byteLength > detectedType.maxSize)
    return json({
      error: `Ficheiro demasiado grande. Máximo ${detectedType.maxSize / 1024 / 1024} MB para ${detectedType.kind === 'image' ? 'imagens' : 'documentos'}.`,
    }, 413, origin);

  // ── 6. Nome seguro (UUID — nunca o nome original) ───────────
  const fileName = `${user.id}/${uuid()}.${detectedType.ext}`;

  // ── 7. Upload para Supabase Storage ────────────────────────
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${detectedType.bucket}/${fileName}`,
    {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_SVC,
        'Authorization': `Bearer ${SUPABASE_SVC}`,
        'Content-Type':  detectedType.mime,
        'x-upsert':      'false',
        'Cache-Control': detectedType.kind === 'image' ? '3600' : 'private',
      },
      body: buffer,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    console.error('[upload] Storage error', uploadRes.status, err);
    return json({ error: 'Erro ao guardar ficheiro. Tenta novamente.' }, 502, origin);
  }

  // ── 8. Resposta ─────────────────────────────────────────────
  // Imagens → URL pública CDN
  // PDFs    → só o path (URL pública não existe; usar /api/download)
  const publicUrl = detectedType.kind === 'image'
    ? `${SUPABASE_URL}/storage/v1/object/public/${detectedType.bucket}/${fileName}`
    : null;

  return json({
    kind: detectedType.kind,
    url:  publicUrl,   // null para PDFs
    path: fileName,    // sempre presente — path no bucket
    mime: detectedType.mime,
    size: buffer.byteLength,
  }, 200, origin);
};
