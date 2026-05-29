# Catch This Idea

> Marketplace de ideias criativas — vende e compra ideias que nunca chegaste a realizar.

[![Netlify Status](https://api.netlify.com/api/v1/badges/catchthisidea/deploy-status)](https://app.netlify.com/projects/catchthisidea/deploys)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![CI](https://github.com/catchthisidea/catch-this-idea/actions/workflows/ci.yml/badge.svg)](https://github.com/catchthisidea/catch-this-idea/actions/workflows/ci.yml)

**Live:** [catchthisidea.com](https://catchthisidea.com)

---

## O que é

Catch This Idea é um marketplace onde qualquer pessoa pode vender ideias criativas — slogans, nomes de empresas, conceitos de apps, receitas, designs e planos de negócio — a compradores que precisam de conceitos prontos.

### Modalidades de venda

| Modalidade | Descrição |
|---|---|
| **Licença** | Comprador usa a ideia; vendedor pode vendê-la a outros |
| **Exclusividade** | Comprador fica com direito único à ideia |
| **Sob encomenda** | Vendedor cria uma versão personalizada |

### Programa de Fidelidade

Cada €10 faturados = 1 ponto. Os pontos reduzem a comissão da plataforma progressivamente:

| Tier | Pontos | Comissão |
|---|---|---|
| Faísca | 0–9 | 10% |
| Artesão | 10–29 | 9% |
| Criador | 30–99 | 8% |
| Autor | 100–249 | 7% |
| Especialista | 250–499 | 6% |
| Mestre | 500+ | 5% |

---

## Stack técnico

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5 + CSS3 + JavaScript vanilla |
| Fonts | Instrument Serif + DM Sans (Google Fonts) |
| Ícones | Tabler Icons (CDN) |
| Backend | Netlify Functions v2 (ES Modules, Node 20) |
| Base de dados | Supabase (PostgreSQL + Auth + Storage + RLS) |
| Pagamentos | Stripe Checkout + Webhooks |
| Email | Resend |
| IA / Moderação | Anthropic Claude Haiku |
| Hosting | Netlify (CDN global) |
| Domínio | Squarespace Domains → Netlify DNS |

---

## Arquitectura

```
Browser
  │
  ├── Static HTML/CSS/JS (Netlify CDN)
  │     ├── index-app.html   ← Marketplace principal
  │     ├── admin.html       ← Painel de administração
  │     ├── perfil.html      ← Perfil público de utilizador
  │     ├── loyalty.html     ← Programa de fidelidade
  │     ├── suggestions.html ← Sugestões
  │     └── help.html        ← Suporte
  │
  └── Netlify Functions (/api/*)
        ├── auth.js          ← Registo, login, refresh token
        ├── ideas.js         ← CRUD de ideias + moderação IA
        ├── checkout.js      ← Criação de sessão Stripe
        ├── webhook.js       ← Eventos Stripe (pagamentos)
        ├── wallet.js        ← Saldo + tier de loyalty
        ├── admin.js         ← Painel admin (moderação, stats, blacklist)
        ├── profile.js       ← Perfil público
        ├── upload.js        ← Upload de imagens/docs (Supabase Storage)
        ├── download.js      ← Download seguro de ficheiros comprados
        ├── moderation.js    ← Análise IA via Claude Haiku
        ├── ratings.js       ← Sistema de avaliações
        ├── views.js         ← Contagem de visualizações
        ├── suggest.js       ← Formulário de sugestões
        ├── support.js       ← Formulário de suporte
        └── claude.js        ← Assistente de criação de ideias

Supabase (PostgreSQL)
  ├── profiles        ← Dados públicos + loyalty + suspensão
  ├── ideas           ← Ideias publicadas + moderação + destaque
  ├── wallets         ← Saldo em cêntimos
  ├── transactions    ← Movimentos de carteira
  ├── purchases       ← Registo de compras Stripe
  ├── ratings         ← Avaliações de compradores
  ├── rejection_log   ← Histórico de rejeições (auditoria)
  ├── blacklist       ← Emails/telemóveis banidos
  └── admin_log       ← Log de acções de administrador
```

---

## Desenvolvimento local

### Pré-requisitos

- [Node.js](https://nodejs.org/) ≥ 20
- [Netlify CLI](https://docs.netlify.com/cli/get-started/) — `npm i -g netlify-cli`
- Conta [Supabase](https://supabase.com), [Stripe](https://stripe.com), [Resend](https://resend.com) e [Anthropic](https://console.anthropic.com)

### Setup

```bash
# 1. Clonar o repositório
git clone https://github.com/catchthisidea/catch-this-idea.git
cd catch-this-idea

# 2. Instalar dependências de desenvolvimento
npm install

# 3. Copiar variáveis de ambiente
cp .env.example .env
# → Preencher .env com as tuas chaves

# 4. Arrancar o servidor de desenvolvimento
npm run dev
# → http://localhost:8888
```

### Schema da base de dados

Corre o ficheiro `supabase/schema.sql` no SQL Editor do Supabase (Supabase Dashboard → SQL Editor → New query).

Adicionalmente, se não estiver aplicado, corre as migrações pendentes:

```sql
-- Loyalty points
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0 NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejection_count INT DEFAULT 0 NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- Destaque nas ideias
ALTER TABLE public.ideas ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE NOT NULL;

-- Reembolsos
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Tabelas auxiliares
CREATE TABLE IF NOT EXISTS public.rejection_log (...);  -- ver supabase/schema.sql
CREATE TABLE IF NOT EXISTS public.blacklist (...);
CREATE TABLE IF NOT EXISTS public.admin_log (...);
```

Ver `supabase/schema.sql` para o schema completo e RPCs.

---

## Variáveis de ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `ANTHROPIC_API_KEY` | API key da Anthropic (Claude) | ✅ |
| `SUPABASE_URL` | URL do projecto Supabase | ✅ |
| `SUPABASE_ANON_KEY` | Chave pública anon do Supabase | ✅ |
| `SUPABASE_SERVICE_KEY` | Chave de serviço do Supabase (admin) | ✅ |
| `STRIPE_SECRET_KEY` | Chave secreta do Stripe | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Segredo do webhook Stripe | ✅ |
| `RESEND_API_KEY` | API key do Resend (email) | ✅ |
| `SITE_URL` | URL canónico do site (para redirects Stripe) | ✅ |

Copia `.env.example` para `.env` e preenche com as tuas credenciais.  
**Nunca commites o ficheiro `.env`.**

---

## Deploy

O projecto usa Netlify para hosting e deploy automático:

```bash
# Preview (testa antes de ir a produção)
npm run deploy

# Produção
npm run deploy:prod
```

O branch `main` faz deploy automático para produção via Netlify CI/CD.  
Pull Requests geram previews automáticos em URLs temporárias.

---

## Workflow de contribuição

```
dev  ──────────────────────────────────► main (produção)
 │                                         ▲
 └── feature/nome-da-feature ─── PR ───────┘
```

```bash
# Trabalhar numa nova funcionalidade
git checkout dev
git checkout -b feature/nome-da-feature

# ... fazer alterações ...

git add <ficheiros>
git commit -m "feat: descrição curta"
git push origin feature/nome-da-feature

# Abrir PR → dev (para review + testes)
# Depois PR dev → main para produção
```

### Convenção de commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/):

| Prefixo | Quando usar |
|---|---|
| `feat:` | Nova funcionalidade |
| `fix:` | Correcção de bug |
| `design:` | Alteração visual/UX |
| `refactor:` | Refactoring sem mudança de comportamento |
| `docs:` | Documentação |
| `chore:` | Configuração, dependências, CI |
| `sql:` | Migrações de schema |

---

## Estrutura de ficheiros

```
catch-this-idea/
├── .github/
│   ├── ISSUE_TEMPLATE/     ← Templates de issues
│   ├── workflows/ci.yml    ← GitHub Actions (CI)
│   └── PULL_REQUEST_TEMPLATE.md
├── netlify/
│   └── functions/          ← Backend serverless (API)
├── scripts/
│   └── check-syntax.mjs   ← Validação de sintaxe JS
├── supabase/
│   └── schema.sql          ← Schema completo da base de dados
├── *.html                  ← Páginas do site
├── *.png / *.ico           ← Assets estáticos
├── .editorconfig           ← Estilo de código
├── .env.example            ← Template de variáveis de ambiente
├── netlify.toml            ← Configuração Netlify + headers HTTP
├── package.json
├── CLAUDE.md               ← Contexto para Claude Code
└── README.md
```

---

## Licença

MIT © 2026 [Catch This Idea](https://catchthisidea.com)
