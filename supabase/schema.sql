-- ============================================================
-- Catch This Idea — Schema completo
-- Actualizado em 2026-05-29
-- Correr no SQL Editor do Supabase (secções por ordem)
-- ============================================================

-- ============================================================
-- 1. PROFILES — dados públicos do utilizador
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio          text check (length(bio) <= 500),
  avatar_url   text,
  role         text not null default 'user' check (role in ('user','admin')),
  created_at   timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Perfis visíveis a todos" on public.profiles;
create policy "Perfis visíveis a todos"
  on public.profiles for select using (true);

drop policy if exists "Utilizador edita o próprio perfil" on public.profiles;
create policy "Utilizador edita o próprio perfil"
  on public.profiles for update using (auth.uid() = id);

drop policy if exists "Utilizador insere o próprio perfil" on public.profiles;
create policy "Utilizador insere o próprio perfil"
  on public.profiles for insert with check (auth.uid() = id);

grant select, insert, update on public.profiles to anon, authenticated, service_role;


-- ============================================================
-- 2. WALLETS — carteira (saldo em cêntimos)
-- ============================================================
create table if not exists public.wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique not null references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz default now()
);

alter table public.wallets enable row level security;

drop policy if exists "Utilizador vê a própria carteira" on public.wallets;
create policy "Utilizador vê a própria carteira"
  on public.wallets for select using (auth.uid() = user_id);

grant select, insert, update on public.wallets to anon, authenticated, service_role;


-- ============================================================
-- 3. TRANSACTIONS — histórico de movimentos
-- ============================================================
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null check (type in ('sale','purchase','commission','withdrawal','topup')),
  amount       integer not null,   -- positivo = entrada, negativo = saída (cêntimos)
  description  text,
  reference_id uuid,               -- id da ideia relacionada
  created_at   timestamptz default now()
);

alter table public.transactions enable row level security;

drop policy if exists "Utilizador vê as próprias transações" on public.transactions;
create policy "Utilizador vê as próprias transações"
  on public.transactions for select using (auth.uid() = user_id);

grant select, insert on public.transactions to anon, authenticated, service_role;


-- ============================================================
-- 4. IDEAS — ideias do marketplace
-- ============================================================
create table if not exists public.ideas (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references auth.users(id) on delete cascade,
  seller_name        text,

  -- Conteúdo multilingue
  title_pt           text not null,
  title_en           text,
  title_fr           text,
  title_es           text,
  desc_pt            text,
  desc_en            text,
  desc_fr            text,
  desc_es            text,

  -- Classificação
  category           text not null,
  emoji              text default '💡',
  badge              text,

  -- Preços e opções
  price_display      text,
  options            jsonb,         -- [{name_pt, type, price_eur}]
  has_phases         boolean default false,
  phases             jsonb,         -- [{name, desc, price}]
  pack_price         numeric(10,2),

  -- Media
  image_url          text,
  doc_url            text,          -- path no bucket idea-docs (privado)

  -- Métricas
  views_count        integer not null default 0,
  sales_count        integer not null default 0,
  avg_rating         numeric(3,2)   default 0,

  -- Estado e moderação
  status             text not null default 'hidden'
                     check (status in ('active','hidden','invalidated')),
  moderation_status  text not null default 'pending'
                     check (moderation_status in ('pending','approved','flagged','rejected')),
  moderation_reason  text,
  moderated_at       timestamptz,
  moderated_by       text,          -- 'ai' | 'human'

  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.ideas enable row level security;

-- Público vê só ideias ativas e aprovadas
drop policy if exists "Ideias públicas visíveis" on public.ideas;
create policy "Ideias públicas visíveis"
  on public.ideas for select
  using (status = 'active' and moderation_status = 'approved');

-- Vendedor vê todas as suas próprias ideias
drop policy if exists "Vendedor vê as próprias ideias" on public.ideas;
create policy "Vendedor vê as próprias ideias"
  on public.ideas for select
  using (auth.uid() = seller_id);

-- Vendedor pode criar ideias
drop policy if exists "Vendedor cria ideias" on public.ideas;
create policy "Vendedor cria ideias"
  on public.ideas for insert
  with check (auth.uid() = seller_id);

-- Vendedor pode actualizar as suas ideias (status)
drop policy if exists "Vendedor actualiza ideias" on public.ideas;
create policy "Vendedor actualiza ideias"
  on public.ideas for update
  using (auth.uid() = seller_id);

grant select, insert, update on public.ideas to anon, authenticated, service_role;


-- ============================================================
-- 5. PURCHASES — compras concluídas
-- ============================================================
create table if not exists public.purchases (
  id                uuid primary key default gen_random_uuid(),
  idea_id           uuid not null references public.ideas(id),
  buyer_id          uuid not null references auth.users(id),
  seller_id         uuid not null references auth.users(id),
  amount_eur        numeric(10,2) not null,
  commission_eur    numeric(10,2) not null default 0,
  option_type       text,
  stripe_session_id text unique,    -- idempotência: evita duplicados
  status            text not null default 'completed'
                    check (status in ('pending','completed','refunded')),
  created_at        timestamptz default now()
);

alter table public.purchases enable row level security;

drop policy if exists "Comprador vê as próprias compras" on public.purchases;
create policy "Comprador vê as próprias compras"
  on public.purchases for select using (auth.uid() = buyer_id);

drop policy if exists "Vendedor vê vendas das suas ideias" on public.purchases;
create policy "Vendedor vê vendas das suas ideias"
  on public.purchases for select using (auth.uid() = seller_id);

grant select, insert on public.purchases to anon, authenticated, service_role;


-- ============================================================
-- 6. RATINGS — avaliações de compradores
-- ============================================================
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  idea_id    uuid not null references public.ideas(id) on delete cascade,
  buyer_id   uuid not null references auth.users(id),
  seller_id  uuid not null references auth.users(id),
  stars      smallint not null check (stars between 1 and 5),
  comment    text check (length(comment) <= 500),
  buyer_name text,
  created_at timestamptz default now(),
  unique(idea_id, buyer_id)   -- um comprador, uma avaliação por ideia
);

alter table public.ratings enable row level security;

drop policy if exists "Avaliações visíveis a todos" on public.ratings;
create policy "Avaliações visíveis a todos"
  on public.ratings for select using (true);

drop policy if exists "Comprador cria avaliação" on public.ratings;
create policy "Comprador cria avaliação"
  on public.ratings for insert with check (auth.uid() = buyer_id);

grant select, insert on public.ratings to anon, authenticated, service_role;


-- ============================================================
-- 7. RPCs (funções atómicas)
-- ============================================================

-- Incrementar visualizações de uma ideia
create or replace function public.increment_idea_views(idea_uuid uuid)
returns void language sql security definer as $$
  update public.ideas
  set views_count = views_count + 1,
      updated_at  = now()
  where id = idea_uuid;
$$;

-- Incrementar vendas de uma ideia
create or replace function public.increment_idea_sales(idea_uuid uuid)
returns void language sql security definer as $$
  update public.ideas
  set sales_count = sales_count + 1,
      updated_at  = now()
  where id = idea_uuid;
$$;

-- Recalcular avg_rating de uma ideia após nova avaliação
create or replace function public.update_idea_avg_rating(idea_uuid uuid)
returns void language sql security definer as $$
  update public.ideas
  set avg_rating = (
    select round(avg(stars)::numeric, 2)
    from public.ratings
    where idea_id = idea_uuid
  ),
  updated_at = now()
  where id = idea_uuid;
$$;

-- Creditar carteira do vendedor e registar transação
create or replace function public.credit_wallet(
  user_uuid    uuid,
  amount_cents integer,
  description  text,
  ref_uuid     uuid default null
)
returns void language plpgsql security definer as $$
begin
  -- Criar carteira se não existir (fallback seguro)
  insert into public.wallets (user_id, balance)
    values (user_uuid, 0)
    on conflict (user_id) do nothing;

  -- Actualizar saldo
  update public.wallets
  set balance    = balance + amount_cents,
      updated_at = now()
  where user_id = user_uuid;

  -- Registar transação
  insert into public.transactions (user_id, type, amount, description, reference_id)
    values (user_uuid, 'sale', amount_cents, description, ref_uuid);
end;
$$;

grant execute on function public.increment_idea_views(uuid)       to service_role;
grant execute on function public.increment_idea_sales(uuid)       to service_role;
grant execute on function public.update_idea_avg_rating(uuid)     to service_role;
grant execute on function public.credit_wallet(uuid,integer,text,uuid) to service_role;


-- ============================================================
-- 8. TRIGGER — criar perfil + carteira ao registar utilizador
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', null),
      'user'
    )
    on conflict (id) do nothing;

  insert into public.wallets (user_id, balance)
    values (new.id, 0)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- 9. MIGRATIONS — colunas e tabelas adicionadas após schema inicial
-- Idempotente: seguro correr múltiplas vezes.
-- Correr no SQL Editor do Supabase por esta ordem.
-- ============================================================

-- ── 9a. profiles — colunas de loyalty, moderação e suspensão ─
alter table public.profiles
  add column if not exists loyalty_points   int         not null default 0,
  add column if not exists rejection_count  int         not null default 0,
  add column if not exists suspended        boolean     not null default false,
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspension_reason text;

-- ── 9b. ideas — destaque, preço base e milestone de views ────
alter table public.ideas
  add column if not exists price                    numeric(10,2),
  add column if not exists featured                 boolean not null default false,
  add column if not exists views_milestone_notified int     not null default 0;

-- ── 9c. purchases — data de reembolso ─────────────────────────
alter table public.purchases
  add column if not exists refunded_at timestamptz;

-- ── 9d. BLACKLIST — emails e telefones banidos ────────────────
create table if not exists public.blacklist (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  phone        text,
  user_id      uuid references auth.users(id) on delete set null,
  display_name text,
  reason       text not null,
  banned_by    text not null,
  created_at   timestamptz default now(),
  constraint blacklist_email_or_phone check (email is not null or phone is not null)
);

alter table public.blacklist enable row level security;
-- Apenas service_role pode ler/escrever na blacklist
grant select, insert, delete on public.blacklist to service_role;

-- ── 9e. REJECTION_LOG — registo de rejeições por utilizador ──
create table if not exists public.rejection_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  idea_id      text not null,
  idea_title   text not null default '—',
  reason       text not null,
  rejected_by  text not null,
  rejected_at  timestamptz default now()
);

alter table public.rejection_log enable row level security;
grant select, insert, delete on public.rejection_log to service_role;

-- ── 9f. ADMIN_LOG — auditoria de ações administrativas ───────
create table if not exists public.admin_log (
  id           uuid primary key default gen_random_uuid(),
  admin_email  text not null,
  action       text not null,
  target_type  text,          -- 'idea' | 'user' | 'blacklist' | 'purchase'
  target_id    text,
  details      text,
  created_at   timestamptz default now()
);

alter table public.admin_log enable row level security;
grant select, insert on public.admin_log to service_role;

-- ── 9g. RPC — acumular pontos de loyalty ─────────────────────
create or replace function public.add_loyalty_points(
  user_uuid    uuid,
  points_to_add int
)
returns void language sql security definer as $$
  update public.profiles
  set loyalty_points = loyalty_points + points_to_add
  where id = user_uuid;
$$;

grant execute on function public.add_loyalty_points(uuid, int) to service_role;

-- ── 9h. Índices úteis para performance ───────────────────────
create index if not exists idx_ideas_seller_id
  on public.ideas(seller_id);

create index if not exists idx_ideas_moderation_status
  on public.ideas(moderation_status);

create index if not exists idx_ideas_featured
  on public.ideas(featured) where featured = true;

create index if not exists idx_purchases_seller_id
  on public.purchases(seller_id);

create index if not exists idx_purchases_created_at
  on public.purchases(created_at desc);

create index if not exists idx_transactions_user_type
  on public.transactions(user_id, type, created_at desc);

create index if not exists idx_rejection_log_user_id
  on public.rejection_log(user_id);

create index if not exists idx_admin_log_created_at
  on public.admin_log(created_at desc);

create index if not exists idx_blacklist_email
  on public.blacklist(email) where email is not null;


-- ============================================================
-- 10. RGPD (GDPR) BY DESIGN
--
-- Implementa os direitos dos titulares de dados (RGPD Cap. III):
--   Art. 15 — Direito de acesso
--   Art. 17 — Direito ao apagamento ("direito a ser esquecido")
--   Art. 20 — Portabilidade dos dados
--   Art. 7(3) — Revogação de consentimento
--
-- PCI-DSS: este schema nunca armazena dados de cartão.
--   Só se armazena o stripe_session_id (identificador de sessão).
--   Dados de cartão são processados exclusivamente pela Stripe (SAQ-A).
-- ============================================================

-- Extensão para hashing e encriptação ao nível de coluna
create extension if not exists pgcrypto;

-- ── 10a. CONSENTS — prova de consentimento e base legal ──────
--
-- Regista o momento exacto, versão do documento e IP pseudonimizado
-- (SHA-256 do IP — nunca o IP em claro, RGPD recital 26).
-- Permite provar o consentimento (RGPD Art. 7(1)) e detectar
-- quando é necessário pedir novo consentimento (actualizações de política).
--
-- Classificação dos dados:
--   ip_hash     → dado pseudonimizado (não permite re-identificação directa)
--   user_agent  → dado técnico não-pessoal (truncado a 200 chars)
--   type        → não pessoal
create table if not exists public.consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         text not null
               check (type in ('terms', 'privacy', 'marketing_email')),
  version      text not null default '1.0',    -- versão do documento aceite
  ip_hash      text,                            -- SHA-256 do IP (pseudonimizado)
  user_agent   text,                            -- browser, truncado a 200 chars
  consented_at timestamptz default now(),
  revoked_at   timestamptz                      -- preenchido ao revogar
);

alter table public.consents enable row level security;

drop policy if exists "Utilizador vê os próprios consentimentos"   on public.consents;
drop policy if exists "Utilizador regista consentimento"           on public.consents;
drop policy if exists "Utilizador revoga consentimento"            on public.consents;

create policy "Utilizador vê os próprios consentimentos"
  on public.consents for select using (auth.uid() = user_id);

create policy "Utilizador regista consentimento"
  on public.consents for insert with check (auth.uid() = user_id);

create policy "Utilizador revoga consentimento"
  on public.consents for update using (auth.uid() = user_id);

grant select, insert, update on public.consents to authenticated, service_role;

create index if not exists idx_consents_user_id
  on public.consents(user_id);


-- ── 10b. GDPR_REQUESTS — registo de exercício de direitos ────
--
-- Mantido 5 anos para demonstrar conformidade (accountability, Art. 5(2)).
-- email_hash mantém-se mesmo após apagamento do utilizador (user_id = null)
-- para verificar que o pedido foi processado sem guardar o email em claro.
create table if not exists public.gdpr_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  email_hash   text not null,                   -- SHA-256 do email (pseudonimizado)
  type         text not null
               check (type in ('access', 'deletion', 'portability', 'rectification', 'restriction')),
  status       text not null default 'pending'
               check (status in ('pending', 'processing', 'completed', 'rejected')),
  requested_at timestamptz default now(),
  completed_at timestamptz,
  completed_by text,                            -- 'system' (auto) ou email do admin
  notes        text
);

alter table public.gdpr_requests enable row level security;

drop policy if exists "Utilizador vê os próprios pedidos RGPD" on public.gdpr_requests;
drop policy if exists "Utilizador cria pedido RGPD"            on public.gdpr_requests;

create policy "Utilizador vê os próprios pedidos RGPD"
  on public.gdpr_requests for select using (auth.uid() = user_id);

create policy "Utilizador cria pedido RGPD"
  on public.gdpr_requests for insert with check (auth.uid() = user_id);

grant select, insert        on public.gdpr_requests to authenticated;
grant select, insert, update on public.gdpr_requests to service_role;

create index if not exists idx_gdpr_requests_user_id
  on public.gdpr_requests(user_id);

create index if not exists idx_gdpr_requests_status
  on public.gdpr_requests(status) where status = 'pending';


-- ── 10c. FUNÇÃO: anonimizar dados pessoais de um utilizador ──
--
-- RGPD Art. 17 — Direito ao apagamento.
--
-- NÃO elimina registos de transações (obrigação legal de retenção por
-- 7 anos: Lei Geral Tributária PT Art. 52, Directiva 2006/112/CE).
-- RGPD Art. 17(3)(b) permite preservar dados quando existe obrigação legal.
--
-- Processo:
--  1. Remove PII do perfil (nome, bio, avatar)
--  2. Anonimiza avaliações (mantém estrelas para integridade do avg_rating)
--  3. Anonimiza nome do vendedor nas ideias (mantém conteúdo — compradores pagaram)
--  4. Revoga consentimentos activos
--  5. Regista a anonimização para accountability
--
-- ⚠ APÓS chamar esta função, o caller deve também:
--    a) Alterar o email em auth.users para um alias anónimo
--    b) Banir a conta em auth.users (ban_duration: '876000h')
--   Estes passos requerem a Admin API e são feitos na função serverless.
create or replace function public.anonymize_user(user_uuid uuid)
returns jsonb language plpgsql security definer as $$
declare
  anon text := '[Conta eliminada]';
begin
  -- 1. Anonimizar perfil (manter linha — integridade referencial das transações)
  update public.profiles set
    display_name      = anon,
    bio               = null,
    avatar_url        = null,
    suspended         = true,
    suspension_reason = 'GDPR_DELETION'
  where id = user_uuid;

  -- 2. Anonimizar avaliações dadas pelo utilizador
  --    (manter stars — integridade de avg_rating das ideias compradas)
  update public.ratings set
    buyer_name = anon,
    comment    = null
  where buyer_id = user_uuid;

  -- 3. Anonimizar nome do vendedor nas suas ideias
  --    (manter conteúdo da ideia — compradores pagaram por ele)
  update public.ideas set
    seller_name = anon
  where seller_id = user_uuid;

  -- 4. Revogar todos os consentimentos activos
  update public.consents set
    revoked_at = now()
  where user_id = user_uuid
    and revoked_at is null;

  -- 5. Desassociar entradas da blacklist sem eliminar o registo de segurança
  update public.blacklist set
    display_name = anon,
    user_id      = null
  where user_id = user_uuid;

  -- 6. Registar para accountability (RGPD Art. 5(2))
  insert into public.admin_log (admin_email, action, target_type, target_id, details)
  values (
    'system@gdpr',
    'anonymize_user',
    'user',
    user_uuid::text,
    'RGPD Art. 17 — direito ao apagamento executado. Transações preservadas (obrigação legal).'
  );

  return jsonb_build_object(
    'anonymized', true,
    'user_id',    user_uuid,
    'timestamp',  now(),
    'note',       'Dados financeiros preservados 7 anos por obrigação legal (LGT Art. 52)'
  );
end;
$$;

grant execute on function public.anonymize_user(uuid) to service_role;


-- ── 10d. FUNÇÃO: exportar todos os dados de um utilizador ────
--
-- RGPD Art. 15 (direito de acesso) + Art. 20 (portabilidade).
-- Devolve jsonb com todos os dados pessoais do titular.
-- Não inclui dados de outros utilizadores.
-- Formato estruturado e legível por máquina (RGPD Art. 20(1)).
create or replace function public.export_user_data(user_uuid uuid)
returns jsonb language plpgsql security definer as $$
declare
  result jsonb;
begin
  select jsonb_strip_nulls(jsonb_build_object(

    'export_metadata', jsonb_build_object(
      'export_date',    now(),
      'format',         'JSON (RGPD Art. 20 — formato estruturado e legível por máquina)',
      'controller',     'Catch This Idea | catchthisidea.com',
      'legal_basis',    'RGPD Art. 15 e Art. 20',
      'contact',        'suporte@catchthisidea.com'
    ),

    -- Perfil público
    'profile', (
      select jsonb_build_object(
        'display_name',   p.display_name,
        'bio',            p.bio,
        'role',           p.role,
        'loyalty_points', p.loyalty_points,
        'created_at',     p.created_at
      )
      from public.profiles p where p.id = user_uuid
    ),

    -- Ideias publicadas como vendedor
    'ideas_published', (
      select jsonb_agg(jsonb_build_object(
        'id',          i.id,
        'title',       i.title_pt,
        'category',    i.category,
        'price',       i.price,
        'status',      i.status,
        'sales_count', i.sales_count,
        'views_count', i.views_count,
        'avg_rating',  i.avg_rating,
        'created_at',  i.created_at
      ))
      from public.ideas i where i.seller_id = user_uuid
    ),

    -- Compras realizadas como comprador
    'purchases', (
      select jsonb_agg(jsonb_build_object(
        'idea_id',     p.idea_id,
        'amount_eur',  p.amount_eur,
        'option_type', p.option_type,
        'status',      p.status,
        'created_at',  p.created_at
      ))
      from public.purchases p where p.buyer_id = user_uuid
    ),

    -- Avaliações submetidas como comprador
    'ratings_given', (
      select jsonb_agg(jsonb_build_object(
        'idea_id',    r.idea_id,
        'stars',      r.stars,
        'comment',    r.comment,
        'created_at', r.created_at
      ))
      from public.ratings r where r.buyer_id = user_uuid
    ),

    -- Carteira (saldo em euros)
    'wallet', (
      select jsonb_build_object(
        'balance_eur', round((w.balance / 100.0)::numeric, 2),
        'updated_at',  w.updated_at
      )
      from public.wallets w where w.user_id = user_uuid
    ),

    -- Histórico de movimentos financeiros
    'transactions', (
      select jsonb_agg(jsonb_build_object(
        'type',        t.type,
        'amount_eur',  round((t.amount / 100.0)::numeric, 2),
        'description', t.description,
        'created_at',  t.created_at
      ) order by t.created_at desc)
      from public.transactions t where t.user_id = user_uuid
    ),

    -- Consentimentos registados
    'consents', (
      select jsonb_agg(jsonb_build_object(
        'type',         c.type,
        'version',      c.version,
        'consented_at', c.consented_at,
        'revoked_at',   c.revoked_at
      ))
      from public.consents c where c.user_id = user_uuid
    ),

    -- Histórico de pedidos RGPD
    'gdpr_requests', (
      select jsonb_agg(jsonb_build_object(
        'type',         g.type,
        'status',       g.status,
        'requested_at', g.requested_at,
        'completed_at', g.completed_at
      ))
      from public.gdpr_requests g where g.user_id = user_uuid
    )

  )) into result;

  return result;
end;
$$;

grant execute on function public.export_user_data(uuid) to service_role;


-- ── 10e. FUNÇÃO: aplicar políticas de retenção ───────────────
--
-- RGPD Art. 5(1)(e) — limitação da conservação.
-- Chamar mensalmente via cron-data-retention.js.
--
-- Períodos de retenção:
--   admin_log       → 2 anos  (auditoria interna)
--   rejection_log   → 1 ano   (utilizadores não suspensos)
--   gdpr_requests   → 5 anos  (accountability RGPD — Art. 5(2))
--   transactions    → 7 anos  (NÃO eliminar — obrigação fiscal LGT Art. 52)
--   consents        → enquanto conta activa + 1 ano (manter prova de consentimento)
create or replace function public.enforce_data_retention()
returns jsonb language plpgsql security definer as $$
declare
  n_admin_logs     int := 0;
  n_rejection_logs int := 0;
  n_gdpr_anon      int := 0;
begin
  -- admin_log: eliminar após 2 anos
  delete from public.admin_log
  where created_at < now() - interval '2 years';
  get diagnostics n_admin_logs = row_count;

  -- rejection_log: eliminar após 1 ano para utilizadores não suspensos
  delete from public.rejection_log rl
  where rl.rejected_at < now() - interval '1 year'
    and not exists (
      select 1 from public.profiles p
      where p.id = rl.user_id and p.suspended = true
    );
  get diagnostics n_rejection_logs = row_count;

  -- gdpr_requests: após 5 anos, anonimizar email_hash (já pseudonimizado, mas boa prática)
  -- Manter o registo para accountability mas tornar completamente anónimo
  update public.gdpr_requests
  set email_hash = 'purged',
      notes      = coalesce(notes, '') || ' | email_hash purgado após 5 anos (RGPD Art. 5(1)(e))'
  where requested_at < now() - interval '5 years'
    and email_hash != 'purged';
  get diagnostics n_gdpr_anon = row_count;

  -- ⚠ transactions: NÃO eliminar (7 anos — LGT Art. 52 + Directiva IVA)
  -- ⚠ purchases:    NÃO eliminar (7 anos — mesma base legal)

  -- Registar execução
  insert into public.admin_log (admin_email, action, target_type, target_id, details)
  values (
    'system@retention',
    'enforce_data_retention',
    'system',
    null,
    format(
      'admin_logs=%s rejection_logs=%s gdpr_anon=%s',
      n_admin_logs, n_rejection_logs, n_gdpr_anon
    )
  );

  return jsonb_build_object(
    'admin_logs_deleted',       n_admin_logs,
    'rejection_logs_deleted',   n_rejection_logs,
    'gdpr_requests_anonymized', n_gdpr_anon,
    'note_transactions',        'Preservadas (7 anos, LGT Art. 52)',
    'executed_at',              now()
  );
end;
$$;

grant execute on function public.enforce_data_retention() to service_role;


-- ── 10f. Nota de conformidade PCI-DSS ────────────────────────
--
-- Este schema NÃO armazena dados de cartão de pagamento.
-- O único identificador Stripe guardado é:
--   purchases.stripe_session_id  (não é dado de cartão — é ID de sessão)
--
-- Todos os dados de cartão são processados exclusivamente pela Stripe
-- através do Stripe Checkout (hosted page).
-- Nível de conformidade PCI-DSS: SAQ-A (mais simples).
-- Referência: https://stripe.com/docs/security/guide
