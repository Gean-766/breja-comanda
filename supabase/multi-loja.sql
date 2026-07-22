-- ============================================================================
--  COMANDA 🍺  →  MULTI-DISTRIBUIDORA (SaaS)
--  Projeto Supabase: dmsqjwwcmfgdsrdsnlma
--
--  COMO RODAR:
--   Supabase → SQL Editor → New query → cola → Run
--
--   >>> São DUAS partes. Rode a PARTE 1 agora (não quebra nada, o app
--       continua funcionando exatamente como está).
--       A PARTE 2 é a que tranca o acesso — rode SÓ quando o app novo
--       (com a tela de login) já estiver no ar.
-- ============================================================================


-- ============================================================================
--  PARTE 1 — ADITIVA (segura, pode rodar agora)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Distribuidoras = os clientes do negócio (cada uma é um "inquilino")
-- ---------------------------------------------------------------------------
create table if not exists distribuidoras (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,                  -- nome que aparece no topo do app dela
  responsavel   text,                           -- dono / quem assina
  whatsapp      text,
  cidade        text,
  login         text unique,                    -- o que a pessoa digita pra entrar
  auth_user_id  uuid unique,                    -- usuário no Supabase Auth (criado pelo painel)
  mensalidade   numeric(10,2) not null default 0,
  dia_vencimento int not null default 10,       -- dia do mês que vence
  vence_em      date,                           -- validade do acesso (null = sem prazo)
  status        text not null default 'ativa',  -- ativa | bloqueada | teste
  obs           text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) Pagamentos das mensalidades (aba Financeiro do painel)
-- ---------------------------------------------------------------------------
create table if not exists pagamentos (
  id               uuid primary key default gen_random_uuid(),
  distribuidora_id uuid not null references distribuidoras(id) on delete cascade,
  valor            numeric(10,2) not null default 0,
  mes_ref          text,                        -- '2026-07'
  pago_em          date not null default current_date,
  forma            text,                        -- pix | dinheiro | transferência...
  obs              text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_pagamentos_distribuidora on pagamentos(distribuidora_id);

-- ---------------------------------------------------------------------------
-- 3) Carimbo de dono em TODAS as tabelas do app
-- ---------------------------------------------------------------------------
alter table cervejas  add column if not exists distribuidora_id uuid references distribuidoras(id) on delete cascade;
alter table clientes  add column if not exists distribuidora_id uuid references distribuidoras(id) on delete cascade;
alter table consumos  add column if not exists distribuidora_id uuid references distribuidoras(id) on delete cascade;
alter table historico add column if not exists distribuidora_id uuid references distribuidoras(id) on delete cascade;

create index if not exists idx_cervejas_dist  on cervejas(distribuidora_id);
create index if not exists idx_clientes_dist  on clientes(distribuidora_id);
create index if not exists idx_consumos_dist  on consumos(distribuidora_id);
create index if not exists idx_historico_dist on historico(distribuidora_id);

-- ---------------------------------------------------------------------------
-- 4) MIGRAÇÃO do cliente que já existe: tudo que está no banco hoje
--    passa a pertencer à "BREJA & CIA". Nada é perdido.
-- ---------------------------------------------------------------------------
insert into distribuidoras (nome, login, status, mensalidade, dia_vencimento)
select 'BREJA & CIA', 'breja', 'ativa', 0, 10
where not exists (select 1 from distribuidoras where nome = 'BREJA & CIA');

update cervejas  set distribuidora_id = (select id from distribuidoras where nome = 'BREJA & CIA') where distribuidora_id is null;
update clientes  set distribuidora_id = (select id from distribuidoras where nome = 'BREJA & CIA') where distribuidora_id is null;
update consumos  set distribuidora_id = (select id from distribuidoras where nome = 'BREJA & CIA') where distribuidora_id is null;
update historico set distribuidora_id = (select id from distribuidoras where nome = 'BREJA & CIA') where distribuidora_id is null;

-- ---------------------------------------------------------------------------
-- 5) "Quem sou eu?" — devolve o id da distribuidora do usuário logado.
--    Devolve NULL se estiver bloqueada ou vencida  →  é isto que corta o
--    acesso automaticamente quando a mensalidade não é paga.
--    security definer: precisa ler `distribuidoras` mesmo com RLS ligado.
-- ---------------------------------------------------------------------------
create or replace function fn_minha_distribuidora()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.id
    from distribuidoras d
   where d.auth_user_id = auth.uid()
     and d.status = 'ativa'
     and (d.vence_em is null or d.vence_em >= current_date)
   limit 1
$$;

revoke all on function fn_minha_distribuidora() from public;
grant execute on function fn_minha_distribuidora() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Carimbo automático: o app não precisa mandar o distribuidora_id,
--    o banco preenche sozinho com a distribuidora de quem está logado.
--    (deixa o código do app praticamente igual)
-- ---------------------------------------------------------------------------
create or replace function fn_set_distribuidora()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.distribuidora_id is null then
    new.distribuidora_id := fn_minha_distribuidora();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dist_cervejas  on cervejas;
drop trigger if exists trg_dist_clientes  on clientes;
drop trigger if exists trg_dist_consumos  on consumos;
drop trigger if exists trg_dist_historico on historico;

create trigger trg_dist_cervejas  before insert on cervejas  for each row execute function fn_set_distribuidora();
create trigger trg_dist_clientes  before insert on clientes  for each row execute function fn_set_distribuidora();
create trigger trg_dist_consumos  before insert on consumos  for each row execute function fn_set_distribuidora();
create trigger trg_dist_historico before insert on historico for each row execute function fn_set_distribuidora();

-- ---------------------------------------------------------------------------
-- 7) Tranca já as tabelas NOVAS (elas guardam login e dinheiro — não podem
--    ficar abertas na janela entre a Parte 1 e a Parte 2).
--    RLS ligado + uma única policy: cada distribuidora lê só a própria linha.
--    `pagamentos` fica sem policy nenhuma de propósito = ninguém acessa pela
--    chave pública; só o painel CEO, que usa service_role no servidor.
-- ---------------------------------------------------------------------------
alter table distribuidoras enable row level security;
alter table pagamentos     enable row level security;

-- Sem filtro de status aqui de propósito: é assim que o app consegue mostrar
-- a tela "acesso expirado" em vez de uma tela vazia sem explicação.
drop policy if exists "ver_minha_loja" on distribuidoras;
create policy "ver_minha_loja" on distribuidoras for select to authenticated
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8) Tempo real continua ligado nas tabelas do app
-- ---------------------------------------------------------------------------
drop publication if exists supabase_realtime;
create publication supabase_realtime for table clientes, consumos, cervejas, historico;

-- ####  FIM DA PARTE 1  ####
-- Confira: select nome, login, status from distribuidoras;


-- ============================================================================
--  PARTE 2 — TRANCA O ACESSO
--  >>> RODE SÓ DEPOIS QUE O APP COM TELA DE LOGIN ESTIVER NO AR. <<<
--  Antes disso, o app atual (que entra sem login) para de enxergar os dados.
-- ============================================================================

-- Tira o acesso público que existia (era "qualquer um com o link vê tudo")
drop policy if exists "acesso_livre" on cervejas;
drop policy if exists "acesso_livre" on clientes;
drop policy if exists "acesso_livre" on consumos;
drop policy if exists "acesso_livre" on historico;

-- Cada distribuidora só enxerga as próprias linhas.
-- `to authenticated` = quem não fez login (chave anon crua) não vê nada.
drop policy if exists "tenant_cervejas"  on cervejas;
drop policy if exists "tenant_clientes"  on clientes;
drop policy if exists "tenant_consumos"  on consumos;
drop policy if exists "tenant_historico" on historico;

create policy "tenant_cervejas" on cervejas for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

create policy "tenant_clientes" on clientes for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

create policy "tenant_consumos" on consumos for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

create policy "tenant_historico" on historico for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

-- (`distribuidoras` e `pagamentos` já foram trancadas na Parte 1, item 7.)

-- ####  FIM DA PARTE 2  ####
-- Confere se sobrou alguma porta aberta:
--   select tablename, policyname, roles from pg_policies where schemaname = 'public';
