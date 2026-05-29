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
