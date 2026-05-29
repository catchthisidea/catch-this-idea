# Catch This Idea — Descrição do Projeto para Claude Code

## O que é este projeto

**Catch This Idea** é um marketplace online onde qualquer pessoa pode vender ideias criativas que nunca colocou em prática — slogans, nomes de empresas, conceitos de apps, receitas, designs e planos de negócio completos. Os compradores podem licenciar, adquirir com exclusividade ou encomendar versões personalizadas das ideias.

Site: `catchthisidea.com` (domínio Squarespace apontado para Netlify)
Hosting: **Netlify** (deploy estático com Netlify Functions para o backend)
Língua por defeito: **Português de Portugal** (com suporte a EN, FR, ES)

---

## Estrutura de ficheiros

```
catch-this-idea/
├── index.html                  ← Site completo (HTML + CSS + JS inline)
├── CLAUDE.md                   ← Este ficheiro
└── netlify/
    └── functions/
        └── claude.js           ← Função serverless que fala com a API da Anthropic
```

---

## Stack técnico

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5 + CSS3 + JavaScript vanilla (sem frameworks) |
| Fonts | Instrument Serif (títulos) + DM Sans (corpo) via Google Fonts |
| Ícones | Tabler Icons (CDN) |
| Backend | Netlify Functions (serverless, Node.js) |
| IA | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Hosting | Netlify (plano gratuito) |
| Domínio | Squarespace Domains → apontado via DNS para Netlify |

---

## Variáveis de ambiente (Netlify)

```
ANTHROPIC_API_KEY=sk-ant-...   ← API key da Anthropic (definida no painel Netlify)
```

---

## Design System

### Paleta de cores
```css
--ink:       #1a0f00   /* texto principal */
--paper:     #fffaf4   /* fundo principal (creme quente) */
--paper2:    #f5ede0   /* fundo secundário */
--or1:       #e86000   /* laranja principal (CTAs, preços, destaques) */
--or2:       #f07800   /* laranja hover */
--or3:       #fab030   /* laranja/amarelo (acentos) */
--or-pale:   #fff0e0   /* laranja muito claro (badges, avatares) */
--muted:     #7a6040   /* texto secundário */
--border:    #ddd0b8   /* bordas */
```

### Tipografia
- **Títulos / display:** `Instrument Serif` (com itálico para ênfase, ex: "têm *valor*")
- **Corpo / UI:** `DM Sans` (pesos 300, 400, 500)

### Logótipo
- Ícone: salpico de tinta laranja com gradiente (laranja escuro → amarelo quente) com lâmpada branca no centro e raios de luz
- Formato: imagem PNG incorporada em base64 no HTML
- Tipografia: `Catch · This · Idea` em Instrument Serif, com "This" em itálico e separadores dourados

---

## Funcionalidades implementadas

### Frontend (index.html)
- [x] Navegação sticky com logo + links + selector de idioma
- [x] Selector de idioma com 4 línguas: PT, EN, FR, ES (troca todo o conteúdo via JS)
- [x] Hero com título, subtítulo, CTAs e estatísticas
- [x] Cards "Em destaque" na coluna direita do hero
- [x] Grid de listings com 6 ideias de exemplo
- [x] Filtros por categoria (Slogans, Nomes, Apps, Negócios, Design, Receitas)
- [x] Modal de compra com seleção de modalidade (licença, exclusividade, custom)
- [x] Modal de publicação de nova ideia (formulário)
- [x] Secção "Como funciona" em fundo escuro
- [x] Banner de call-to-action para vendedores
- [x] Toda a UI totalmente traduzida nas 4 línguas

### Backend (netlify/functions/claude.js)
- [ ] Endpoint `/api/claude` para comunicação segura com a API da Anthropic
- [ ] A API key nunca é exposta no frontend

---

## Funcionalidades por implementar (backlog)

- [ ] **Assistente de publicação** — Claude ajuda o vendedor a escrever uma descrição apelativa
- [ ] **Sugestão de categoria** — Claude analisa a ideia e sugere a categoria e preço ideais
- [ ] **Chat de suporte** — responde a dúvidas de compradores
- [ ] **Sistema de pagamentos** — integração com Stripe
- [ ] **Autenticação de utilizadores** — registo e login (Netlify Identity ou Auth0)
- [ ] **Base de dados** — persistência de ideias e utilizadores (Supabase ou Fauna)
- [ ] **Dashboard do vendedor** — métricas de visualizações e vendas
- [ ] **Sistema de mensagens** — comunicação entre comprador e vendedor
- [ ] **Avaliações e reviews** — sistema de rating para criadores

---

## Padrões e convenções de código

### HTML/CSS
- CSS em variáveis CSS (`--var`) sempre que possível
- Sem frameworks CSS — tudo vanilla
- Classes semânticas em inglês (ex: `.fcard-price`, `.hero-sub`)
- Layout em CSS Grid e Flexbox
- Mobile-first não implementado ainda — atualmente desktop-first

### JavaScript
- Vanilla JS sem dependências
- Sistema de i18n simples: objeto `T` com todas as traduções, função `setLang(lang)`
- Dados de exemplo hardcoded no array `listings[]`
- Cada listing tem campos por idioma: `tp` (título), `dp` (descrição), `op` (opções), `rp` (rating)

### Netlify Functions
- Formato ES Modules (`export default async (req) => {}`)
- Endpoint definido via `export const config = { path: '/api/...' }`
- Sempre validar método HTTP antes de processar
- Nunca logar a API key

---

## Contexto de negócio

### Modelo de receita
- Plataforma cobra **10% de comissão** sobre cada venda concluída (vendedor fica com 90%)
- Pagamento protegido: ideia só entregue após confirmação de pagamento

### Programa de fidelidade (Loyalty)
- Cada **€10 faturados = 1 ponto** (acumulação vitalícia)
- Pontos reduzem a comissão progressivamente:

| Pontos | Faturado total | Comissão |
|--------|---------------|----------|
| 0 – 9  | €0 – €99      | 10%      |
| 10 – 29 | €100 – €299  | 9%       |
| 30 – 99 | €300 – €999  | 8%       |
| 100 – 249 | €1.000 – €2.499 | 7%  |
| 250 – 499 | €2.500 – €4.999 | 6%  |
| 500+   | €5.000+       | 5% (teto mínimo) |

### Modalidades de venda disponíveis
1. **Licença de uso** — comprador usa a ideia, vendedor pode vender a outros
2. **Exclusividade** — comprador fica com direito único à ideia
3. **Sob encomenda / Custom** — vendedor cria uma versão personalizada

### Categorias de ideias
- Slogans
- Nomes de empresa
- Conceitos de app
- Ideias de negócio
- Receitas
- Design (sistemas de ícones, identidades visuais, etc.)
- Histórias / guiões

### Público-alvo
- **Vendedores:** criativos, designers, empreendedores com ideias não realizadas
- **Compradores:** startups, agências, empreendedores que precisam de conceitos prontos

---

## Deploy

```bash
# O site é um ficheiro estático — não há build step
# Basta fazer upload da pasta para o Netlify via drag-and-drop
# ou via Netlify CLI:

netlify deploy --prod --dir .
```

---

## Contacto e repositório

- Projeto em desenvolvimento — sem repositório Git configurado ainda
- Hosting: Netlify (dashboard em app.netlify.com)
- Domínio: gerido via Squarespace Domains
