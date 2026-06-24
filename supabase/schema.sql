-- ============================================================
--  COMANDA 🍺  — Banco de dados (Supabase / Postgres)
--  Cole TUDO isto no Supabase: menu "SQL Editor" -> New query -> Run
-- ============================================================

-- 1) Cervejas (catálogo com preço)
create table if not exists cervejas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  preco numeric(10,2) not null default 0,
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- 2) Clientes (cada comanda aberta)
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  aberto boolean not null default true,
  pago_em timestamptz,
  created_at timestamptz not null default now()
);

-- 3) Consumos (cada vez que pega cerveja, com horário)
create table if not exists consumos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  beer_nome text not null,
  preco_unit numeric(10,2) not null,
  quantidade int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_consumos_cliente on consumos(cliente_id);

-- 4) Segurança: como NÃO tem login (só o link), liberamos o acesso público.
--    (A chave usada no site é a "anon", feita para ser pública.)
alter table cervejas enable row level security;
alter table clientes enable row level security;
alter table consumos enable row level security;

drop policy if exists "acesso_livre" on cervejas;
drop policy if exists "acesso_livre" on clientes;
drop policy if exists "acesso_livre" on consumos;

create policy "acesso_livre" on cervejas for all using (true) with check (true);
create policy "acesso_livre" on clientes for all using (true) with check (true);
create policy "acesso_livre" on consumos for all using (true) with check (true);

-- 5) Cervejas iniciais (ajuste os preços depois na aba "Cervejas" do app)
insert into cervejas (nome, preco, ordem) values
  ('Brahma',    5.00, 0),
  ('Original',  7.00, 1),
  ('Heineken',  8.00, 2),
  ('Spaten',    7.00, 3),
  ('Antarctica',5.00, 4);
