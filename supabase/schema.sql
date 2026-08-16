-- ============================================================================
--  COMANDA 🍺  — Banco de dados (Supabase / Postgres)
--
--  ⚠️  LEIA ANTES DE RODAR
--  ------------------------------------------------------------------------
--  Este é o arquivo de INSTALAÇÃO NOVA: cria as tabelas do começo. Ele é
--  seguro (tudo é "if not exists"), mas ele NÃO libera o acesso — quem faz
--  isso é o `multi-loja.sql`, e é ele que tranca cada loja na sua própria
--  parte. Rode nesta ordem:
--
--      1. schema.sql       (este aqui — cria as tabelas)
--      2. multi-loja.sql   (login e isolamento entre lojas)
--      3. os módulos que o cliente tiver: estoque, caixa-turno, perdas,
--         conta-dividida, forma-pagamento, cozinha, foto-produto…
--
--  HISTÓRICO: até agosto/2026 este arquivo terminava criando políticas
--  "acesso_livre" (`using (true)`) e recriando a publicação do tempo real do
--  zero. Fazia sentido quando o app não tinha login e o acesso era só pelo
--  link. Hoje não faz mais, e rodá-lo assim num banco em produção:
--    • deixaria TODAS as lojas enxergando os dados umas das outras, com a
--      chave anon — que é pública e está dentro do JavaScript do site;
--    • derrubaria o tempo real das tabelas criadas depois (caixas, perdas,
--      pagamentos_parciais, estoque_entradas).
--  As duas partes saíram daqui. O acesso agora é só pelo multi-loja.sql.
-- ============================================================================

-- 1) Cervejas (catálogo com preço)
create table if not exists cervejas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tamanho text not null default '',
  preco numeric(10,2) not null default 0,
  ativo boolean not null default true,
  ordem int not null default 0,
  cor text,
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

-- 4) Histórico de movimentações (auditoria + desfazer)
--    Toda ação (abrir/excluir comanda, lançar/remover item, mexer em
--    produto/preço) grava uma linha aqui. O app mostra as últimas 24h; o banco
--    guarda ~30 dias (limpeza automática). "payload" guarda o necessário pra
--    DESFAZER (ex: a pessoa e todo o consumo dela).
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

-- 5) RLS LIGADO, sem nenhuma política.
--    Ligar sem política = ninguém entra. É de propósito: o banco fica trancado
--    até o multi-loja.sql dizer quem pode ver o quê. Um banco recém-criado que
--    não abre é um problema visível; um que abre pra todo mundo, não.
alter table cervejas  enable row level security;
alter table clientes  enable row level security;
alter table consumos  enable row level security;
alter table historico enable row level security;

-- Faxina: se este banco já rodou a versão antiga deste arquivo, as políticas
-- "acesso_livre" ainda estão lá deixando tudo aberto. Tira.
drop policy if exists "acesso_livre" on cervejas;
drop policy if exists "acesso_livre" on clientes;
drop policy if exists "acesso_livre" on consumos;
drop policy if exists "acesso_livre" on historico;

-- 6) Tempo real entre celulares.
--    ADITIVO: adiciona uma tabela por vez, sem recriar a publicação. Recriar
--    derrubaria o tempo real das tabelas dos módulos (caixas, perdas,
--    pagamentos_parciais, estoque_entradas), que entram nos outros arquivos.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['clientes', 'consumos', 'cervejas', 'historico'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      when duplicate_object then null;  -- já estava na publicação, tudo certo
    end;
  end loop;
end $$;

-- ####  FIM  ####
-- PRÓXIMO PASSO OBRIGATÓRIO: rodar o `multi-loja.sql`. Até lá o banco está
-- trancado e o app não vai enxergar nada — o que é o esperado.
--
-- Confere o que está trancado:
--   select tablename, policyname, roles from pg_policies where schemaname = 'public';
