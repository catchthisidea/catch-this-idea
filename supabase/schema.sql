-- ============================================================
-- Catch This Idea — Schema inicial
-- Correr no SQL Editor do Supabase
-- ============================================================

-- 1. PROFILES — dados públicos do utilizador
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique,
  full_name   text,
  avatar_url  text,
  bio         text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

-- Qualquer pessoa pode ver perfis públicos
create policy "Perfis visíveis a todos"
  on public.profiles for select using (true);

-- Só o próprio utilizador pode editar o seu perfil
create policy "Utilizador edita o próprio perfil"
  on public.profiles for update using (auth.uid() = id);


-- 2. WALLETS — carteira de cada utilizador (saldo em cêntimos)
create table public.wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique not null references auth.users(id) on delete cascade,
  balance     integer not null default 0 check (balance >= 0),
  updated_at  timestamptz default now()
);

alter table public.wallets enable row level security;

-- Só o próprio utilizador vê a sua carteira
create policy "Utilizador vê a própria carteira"
  on public.wallets for select using (auth.uid() = user_id);


-- 3. TRANSACTIONS — histórico de movimentos
create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in ('sale','purchase','commission','withdrawal','topup')),
  amount        integer not null,  -- positivo = entrada, negativo = saída (em cêntimos)
  description   text,
  reference_id  uuid,              -- id da ideia vendida/comprada (futuro)
  created_at    timestamptz default now()
);

alter table public.transactions enable row level security;

-- Só o próprio utilizador vê as suas transações
create policy "Utilizador vê as próprias transações"
  on public.transactions for select using (auth.uid() = user_id);


-- ============================================================
-- TRIGGER: cria perfil + carteira automaticamente no registo
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id)
    values (new.id);
  insert into public.wallets (user_id)
    values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
