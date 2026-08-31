-- ============================================================================
--  BACKUP COMPLETO DE UMA LOJA — gera o SQL que restaura tudo de volta
--  Roda no Supabase → SQL Editor. É SOMENTE LEITURA: não altera nada, pode
--  rodar com o bar vendendo.
--
--  COMO USAR
--   1. Troca o login na linha marcada abaixo (é o ÚNICO lugar pra mexer).
--   2. Roda. Vem UMA coluna só, com o arquivo inteiro dentro.
--   3. "Download CSV" e guarda no PC, ex.: backup-bola7-2026-08-31.sql.
--
--  COMO RESTAURAR: abre o arquivo, cola no SQL Editor e roda. Todo insert tem
--  "on conflict (id) do nothing" — rodar por cima do que existe completa o que
--  falta sem duplicar e sem atropelar o que veio depois.
--
--  ------------------------------------------------------------------------
--  O QUE MUDOU NESTA VERSÃO (31/08/2026) — e por que importa
--  ------------------------------------------------------------------------
--  1. A LINHA DA LOJA entrou no backup, e vem PRIMEIRO.
--     Antes não entrava. Como toda linha das outras tabelas aponta pra loja
--     (`distribuidora_id`), sem ela o Postgres recusava o arquivo INTEIRO por
--     chave estrangeira — e o "on conflict do nothing" não socorre, porque ele
--     só perdoa id repetido, não perdoa pai faltando. O backup parecia bom e
--     não voltava.
--
--  2. As COLUNAS não são mais escritas na mão.
--     A versão antiga listava coluna por coluna. Toda coluna criada depois
--     (custo_caixa, forma_pagamento, pronto_em, hora_virada, modulos...) ficava
--     de fora calada. Agora o próprio banco diz quais são, então coluna nova
--     entra sozinha no backup.
--
--  3. A loja é escolhida pelo LOGIN, não pelo uuid chumbado.
--     Antes o uuid da Bola 7 estava fixo em 18 lugares. Cliente novo = arquivo
--     novo, ou (pior) um backup que roda bonitinho e salva a loja errada.
--
--  4. Entraram `caixas` (a que noite pertence cada venda) e `historico`
--     (de qual aparelho saiu cada movimentação — o caso do Ceará).
--
--  NÃO ENTRA AQUI: as fotos dos produtos, que ficam no Storage do Supabase e
--  precisam ser baixadas à parte.
-- ============================================================================

with loja as (
  -- ▼▼▼ O ÚNICO LUGAR PRA MEXER ▼▼▼
  select id from public.distribuidoras where login = 'bola7'
  -- ▲▲▲ confere com: select nome, login from distribuidoras; ▲▲▲
),

-- Cada tabela vira uma linha crua (`to_jsonb`) + a ordem em que ela precisa
-- ser restaurada. A ordem NÃO é decoração: o filho não entra antes do pai.
-- A venda aponta pra comanda, a entrada de estoque aponta pro produto, e
-- absolutamente tudo aponta pra loja — por isso ela é a de número 1.
linhas as (
            select  1 as ord, 'distribuidoras'      as tab, to_jsonb(t) as j, t.created_at as quando
              from public.distribuidoras      t where t.id               = (select id from loja)
  union all select  2, 'pagamentos',          to_jsonb(t), t.created_at
              from public.pagamentos          t where t.distribuidora_id = (select id from loja)
  union all select  3, 'caixas',              to_jsonb(t), t.created_at
              from public.caixas              t where t.distribuidora_id = (select id from loja)
  union all select  4, 'cervejas',            to_jsonb(t), t.created_at
              from public.cervejas            t where t.distribuidora_id = (select id from loja)
  union all select  5, 'estoque_entradas',    to_jsonb(t), t.created_at
              from public.estoque_entradas    t where t.distribuidora_id = (select id from loja)
  union all select  6, 'clientes',            to_jsonb(t), t.created_at
              from public.clientes            t where t.distribuidora_id = (select id from loja)
  union all select  7, 'consumos',            to_jsonb(t), t.created_at
              from public.consumos            t where t.distribuidora_id = (select id from loja)
  union all select  8, 'pagamentos_parciais', to_jsonb(t), t.created_at
              from public.pagamentos_parciais t where t.distribuidora_id = (select id from loja)
  union all select  9, 'perdas',              to_jsonb(t), t.created_at
              from public.perdas              t where t.distribuidora_id = (select id from loja)
  union all select 10, 'historico',           to_jsonb(t), t.created_at
              from public.historico           t where t.distribuidora_id = (select id from loja)
),

-- Monta o "insert ... values (...)" a partir da linha crua. Escrito UMA vez e
-- serve pra todas as tabelas.
--
-- Sobre os valores: quase tudo sai como texto entre aspas de propósito. O
-- Postgres converte sozinho na hora de gravar ('47.50' vira numérico, 'true'
-- vira booleano, a data vira data), e assim não precisa adivinhar tipo aqui.
-- As duas exceções são NULL (que não pode levar aspas, senão vira a palavra
-- "null" escrita) e as listas — hoje só `modulos`, que é text[] e não aceita
-- o formato JSON; ela vira array[...]::text[].
sql_das_linhas as (
  select
    l.ord,
    row_number() over (partition by l.ord order by l.quando, l.j->>'id') as seq,
    'insert into public.' || l.tab || ' ('
    || (select string_agg(quote_ident(e.key), ', ' order by e.key) from jsonb_each(l.j) e)
    || ') values ('
    || (select string_agg(
          case
            when e.value = 'null'::jsonb then 'null'
            when jsonb_typeof(e.value) = 'array' then
              coalesce(
                'array['
                || (select string_agg(quote_literal(a), ', ') from jsonb_array_elements_text(e.value) a)
                || ']::text[]',
                'array[]::text[]'
              )
            when jsonb_typeof(e.value) = 'string' then quote_literal(e.value #>> '{}')
            else quote_literal(e.value::text)
          end, ', ' order by e.key)
        from jsonb_each(l.j) e)
    || ') on conflict (id) do nothing;' as linha
  from linhas l
)

select z.linha
  from (
            select 0 as ord, 0::bigint as seq,
                   '-- BACKUP de '
                   || (select nome from public.distribuidoras where id = (select id from loja))
                   || ' — gerado em '
                   || to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY HH24:MI') as linha
  union all select 0, 1, '-- Cole este arquivo inteiro no SQL Editor do Supabase e rode.'
  union all select 0, 2, '-- A ordem das linhas E a ordem certa de restauracao. Nao reordene.'
  union all select 0, 3, ''
  union all select s.ord, s.seq, s.linha from sql_das_linhas s
       ) z
 order by z.ord, z.seq;

-- ####  FIM  ####
--
-- CONFERÊNCIA (rode antes de confiar no arquivo): o número de linhas do
-- resultado tem que bater com a soma daqui, mais 4 do cabeçalho.
--
--   with loja as (select id from public.distribuidoras where login = 'bola7')
--   select 'distribuidoras' t, count(*) from public.distribuidoras where id = (select id from loja)
--   union all select 'pagamentos',          count(*) from public.pagamentos          where distribuidora_id = (select id from loja)
--   union all select 'caixas',              count(*) from public.caixas              where distribuidora_id = (select id from loja)
--   union all select 'cervejas',            count(*) from public.cervejas            where distribuidora_id = (select id from loja)
--   union all select 'estoque_entradas',    count(*) from public.estoque_entradas    where distribuidora_id = (select id from loja)
--   union all select 'clientes',            count(*) from public.clientes            where distribuidora_id = (select id from loja)
--   union all select 'consumos',            count(*) from public.consumos            where distribuidora_id = (select id from loja)
--   union all select 'pagamentos_parciais', count(*) from public.pagamentos_parciais where distribuidora_id = (select id from loja)
--   union all select 'perdas',              count(*) from public.perdas              where distribuidora_id = (select id from loja)
--   union all select 'historico',           count(*) from public.historico           where distribuidora_id = (select id from loja);
