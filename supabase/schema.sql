-- ============================================================
--  COMANDA 🍺  — Banco de dados (Supabase / Postgres)
--  Cole TUDO isto no Supabase: menu "SQL Editor" -> New query -> Run
-- ============================================================

-- 1) Cervejas (catálogo com preço)
create table if not exists cervejas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tamanho text not null default '',
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

-- 5) Cervejas iniciais (ajuste os preços/tamanhos depois na aba "Produtos" do app)
insert into cervejas (nome, tamanho, preco, ordem) values
  ('Brahma',    'Lata', 5.00, 0),
  ('Original',  'Lata', 7.00, 1),
  ('Heineken',  'Lata', 8.00, 2),
  ('Spaten',    'Lata', 7.00, 3),
  ('Antarctica','Lata', 5.00, 4);

-- ============================================================
-- 6) ATUALIZAÇÃO (rode isto uma vez no SQL Editor):
--    - coluna de cor do card  - tempo real entre celulares
-- ============================================================
alter table cervejas add column if not exists cor text;

-- Tempo real entre celulares: recria a publicação com as 3 tabelas (garantido).
drop publication if exists supabase_realtime;
create publication supabase_realtime for table clientes, consumos, cervejas;

-- ============================================================
-- 7) HISTÓRICO de movimentações (auditoria + desfazer)
--    Toda ação (abrir/excluir comanda, lançar/remover item, mexer
--    em produto/preço) grava uma linha aqui. O app mostra as últimas
--    24h; o banco guarda ~30 dias (limpeza automática). "payload"
--    guarda o necessário pra DESFAZER (ex: a pessoa e todo o consumo
--    dela). "autor" fica pronto pra quando houver login dos garçons.
--    >> Rode este bloco uma vez no SQL Editor. <<
-- ============================================================
create table if not exists historico (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                 -- abrir_cliente, excluir_cliente, etc.
  descricao text not null,            -- texto legível ("Excluiu a comanda de Alex")
  payload jsonb not null default '{}',-- dados pra reverter a ação
  autor text,                         -- quem fez (preenchido quando houver login)
  revertido boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_historico_data on historico(created_at desc);

alter table historico enable row level security;
drop policy if exists "acesso_livre" on historico;
create policy "acesso_livre" on historico for all using (true) with check (true);

-- inclui o historico no tempo real
drop publication if exists supabase_realtime;
create publication supabase_realtime for table clientes, consumos, cervejas, historico;
