-- =====================================================================
-- Gestão da Locadora — banco de dados (Supabase / Postgres)
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run
-- Pode ser executado mais de uma vez sem problema.
-- =====================================================================

-- ---------- Tabelas ----------

-- Cada cliente (locadora) que assina o sistema.
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Minha locadora',
  email text,
  responsavel text,
  telefone text,
  criado_em timestamptz not null default now(),
  trial_ate date not null default (current_date + 7),   -- teste grátis de 7 dias
  pago_ate date,                                       -- acesso pago até esta data
  status text not null default 'teste'
    check (status in ('teste','ativa','atrasada','cancelada','bloqueada')),
  asaas_customer_id text,
  asaas_subscription_id text
);

-- Quem pode entrar em cada empresa.
create table if not exists public.membros (
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  papel text not null default 'dono',
  primary key (user_id, empresa_id)
);

-- Todos os dados do app (veículos, clientes, locações, lançamentos, multas, configurações),
-- sempre separados por empresa.
create table if not exists public.registros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colecao text not null,
  doc_id text not null,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, colecao, doc_id)
);
create index if not exists registros_empresa_idx on public.registros (empresa_id);

-- Histórico de pagamentos recebidos pelo Asaas.
create table if not exists public.pagamentos (
  asaas_payment_id text primary key,
  empresa_id uuid references public.empresas(id) on delete set null,
  valor numeric(12,2),
  vencimento date,
  status text,
  forma text,
  fatura_url text,
  atualizado_em timestamptz not null default now()
);

-- Você (dono do sistema) e quem mais puder ver o painel de clientes.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---------- Funções de apoio ----------

create or replace function public.minhas_empresas()
returns setof uuid language sql stable security definer set search_path = public as $$
  select empresa_id from membros where user_id = auth.uid();
$$;

create or replace function public.sou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- Acesso liberado: dentro do teste grátis ou com pagamento em dia (3 dias de tolerância).
-- Quem cancela continua usando até o fim do período já pago.
create or replace function public.acesso_liberado(e uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from empresas
    where id = e and status <> 'bloqueada'   -- 'bloqueada' só o administrador usa
      and (trial_ate >= current_date or (pago_ate is not null and pago_ate + 3 >= current_date))
  );
$$;

-- Atualiza a data de alteração dos registros.
create or replace function public.tocar_registro()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists registros_tocar on public.registros;
create trigger registros_tocar before update on public.registros
  for each row execute function public.tocar_registro();

-- Quando alguém cria conta, nasce a empresa dela com 7 dias de teste.
create or replace function public.nova_conta()
returns trigger language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  insert into empresas (nome, email, responsavel, telefone)
  values (
    coalesce(nullif(trim(new.raw_user_meta_data->>'empresa'), ''), 'Minha locadora'),
    new.email,
    nullif(trim(new.raw_user_meta_data->>'nome'), ''),
    nullif(trim(new.raw_user_meta_data->>'telefone'), '')
  )
  returning id into e;
  insert into membros (user_id, empresa_id, papel) values (new.id, e, 'dono');
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.nova_conta();

-- ---------- Segurança (cada locadora só vê os próprios dados) ----------

alter table public.empresas   enable row level security;
alter table public.membros    enable row level security;
alter table public.registros  enable row level security;
alter table public.pagamentos enable row level security;
alter table public.admins     enable row level security;

drop policy if exists empresas_ler on public.empresas;
create policy empresas_ler on public.empresas for select to authenticated
  using (id in (select public.minhas_empresas()) or public.sou_admin());

drop policy if exists empresas_admin_altera on public.empresas;
create policy empresas_admin_altera on public.empresas for update to authenticated
  using (public.sou_admin()) with check (public.sou_admin());

drop policy if exists membros_ler on public.membros;
create policy membros_ler on public.membros for select to authenticated
  using (user_id = auth.uid() or public.sou_admin());

drop policy if exists registros_ler on public.registros;
create policy registros_ler on public.registros for select to authenticated
  using (empresa_id in (select public.minhas_empresas()));

drop policy if exists registros_criar on public.registros;
create policy registros_criar on public.registros for insert to authenticated
  with check (empresa_id in (select public.minhas_empresas()) and public.acesso_liberado(empresa_id));

drop policy if exists registros_alterar on public.registros;
create policy registros_alterar on public.registros for update to authenticated
  using (empresa_id in (select public.minhas_empresas()) and public.acesso_liberado(empresa_id))
  with check (empresa_id in (select public.minhas_empresas()) and public.acesso_liberado(empresa_id));

drop policy if exists registros_apagar on public.registros;
create policy registros_apagar on public.registros for delete to authenticated
  using (empresa_id in (select public.minhas_empresas()) and public.acesso_liberado(empresa_id));

drop policy if exists pagamentos_ler on public.pagamentos;
create policy pagamentos_ler on public.pagamentos for select to authenticated
  using (empresa_id in (select public.minhas_empresas()) or public.sou_admin());

drop policy if exists admins_ler on public.admins;
create policy admins_ler on public.admins for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.registros to authenticated;
grant select, update on public.empresas to authenticated;
grant select on public.membros, public.pagamentos, public.admins to authenticated;

-- Atualização em tempo real (as mudanças aparecem na hora em todos os aparelhos).
do $$ begin
  alter publication supabase_realtime add table public.registros;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- =====================================================================
-- DEPOIS de criar a SUA conta no app, rode a linha abaixo trocando o e-mail
-- para virar administrador e ver o painel "Clientes":
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'seu-email@exemplo.com'
--   on conflict do nothing;
-- =====================================================================
