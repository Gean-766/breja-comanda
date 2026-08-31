-- ============================================================================
--  BACKUP COMPLETO DE UMA LOJA - gera o SQL que restaura tudo de volta
--  Roda no Supabase, SQL Editor. E SOMENTE LEITURA: nao altera nada, pode
--  rodar com o bar vendendo.
--
--  COMO USAR
--   1. Troca o login na linha marcada abaixo. E o UNICO lugar pra mexer.
--   2. Roda o arquivo inteiro. Vem UMA coluna so, com o backup dentro.
--   3. Download CSV e guarda no PC, ex.: backup-bola7-2026-08-31.sql
--   4. Confere com o arquivo backup-confere.sql, que fica do lado deste.
--
--  COMO RESTAURAR: abre o arquivo, cola no SQL Editor e roda. Todo insert tem
--  on conflict do nothing, entao rodar por cima do que existe completa o que
--  falta sem duplicar e sem atropelar o que veio depois.
--
--  ------------------------------------------------------------------------
--  POR QUE ESTE ARQUIVO NAO TEM PONTO-E-VIRGULA NEM ASPAS NOS COMENTARIOS
--  ------------------------------------------------------------------------
--  A primeira versao tinha, e o editor do Supabase devolvia
--  "relation public does not exist" sem explicar nada. O editor limpa e
--  divide o texto ANTES de mandar pro banco, e nessa hora ele nao sabe que um
--  ponto-e-virgula dentro de um comentario nao termina o comando. Ele cortava
--  a consulta no meio e mandava metade.
--
--  Por isso, daqui pra frente, em arquivo que vai ser colado no SQL Editor:
--    - nenhum ponto-e-virgula dentro de comentario
--    - nenhuma aspa simples dentro de comentario
--    - nenhum traco-traco dentro de texto entre aspas
--  A consulta de conferencia, que precisava de tudo isso, saiu daqui e virou
--  o arquivo backup-confere.sql.
--
--  ------------------------------------------------------------------------
--  O QUE ESTA VERSAO CONSERTOU (31/08/2026)
--  ------------------------------------------------------------------------
--  1. A LINHA DA LOJA entrou no backup, e vem PRIMEIRO.
--     Antes nao entrava. Como toda linha das outras tabelas aponta pra loja
--     pela coluna distribuidora_id, sem ela o Postgres recusa o arquivo
--     INTEIRO por chave estrangeira na hora de restaurar. E o
--     on conflict do nothing nao socorre: ele so perdoa id repetido, nao
--     perdoa pai faltando. O backup parecia completo e nao voltava.
--
--  2. As COLUNAS nao sao mais escritas na mao.
--     A versao antiga listava coluna por coluna. Toda coluna criada depois
--     ficava de fora calada: custo_caixa, forma_pagamento, pronto_em,
--     hora_virada, modulos. Agora quem diz quais sao e o proprio banco.
--
--  3. A loja e escolhida pelo LOGIN, nao pelo uuid chumbado em 18 lugares.
--
--  4. Entraram caixas, que diz a que noite pertence cada venda, e historico,
--     que diz de qual aparelho saiu cada movimentacao.
--
--  NAO ENTRA AQUI: as fotos dos produtos, que ficam no Storage do Supabase e
--  precisam ser baixadas a parte.
-- ============================================================================

with loja as (

  -- >>>>>>>>>>  O UNICO LUGAR PRA MEXER: troque bola7 pelo login da loja
  select id from public.distribuidoras where login = 'bola7'

),

-- Cada tabela vira uma linha crua, via to_jsonb, mais a ordem em que ela
-- precisa ser restaurada. A ordem NAO e decoracao: o filho nao entra antes do
-- pai. A venda aponta pra comanda, a entrada de estoque aponta pro produto, e
-- absolutamente tudo aponta pra loja. Por isso a loja e a de numero 1.
linhas as (
            select  1 as ord, 'distribuidoras' as tab, to_jsonb(t) as j, t.created_at as quando
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

-- Monta o insert a partir da linha crua. Escrito UMA vez, serve pra todas as
-- tabelas, e por isso coluna nova entra sozinha no backup.
--
-- Sobre os valores: quase tudo sai como texto entre aspas de proposito. O
-- Postgres converte sozinho na hora de gravar, o numero vira numero, o true
-- vira booleano, a data vira data. Assim nao precisa adivinhar tipo aqui.
-- Duas excecoes: NULL, que nao pode levar aspas senao vira a palavra escrita,
-- e as listas. Hoje a unica lista e a coluna modulos, que e text[] e nao
-- aceita o formato JSON, entao ela sai como array[...]::text[].
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
    -- O ponto-e-virgula que fecha cada insert do arquivo GERADO sai de
    -- chr(59), e nao escrito direto entre aspas. Escrito direto, ele era o
    -- unico ponto-e-virgula no meio da consulta, e o editor do Supabase
    -- cortava tudo exatamente aqui. Era esse o "relation public does not
    -- exist" que aparecia sem explicacao.
    || ') on conflict (id) do nothing' || chr(59) as linha
  from linhas l
)

-- A primeira linha do arquivo baixado e um comentario dizendo de quem e o
-- backup e de quando. O traco-traco que abre esse comentario e montado com
-- repeat(chr(45), 2), e nao escrito direto entre aspas, porque um editor que
-- limpa comentarios antes de mandar pro banco comeria a linha inteira.
select z.linha
  from (
            select 0 as ord, 0::bigint as seq,
                   repeat(chr(45), 2) || ' BACKUP de ' || d.nome || ' em '
                   || to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY HH24:MI') as linha
              from public.distribuidoras d
             where d.id = (select id from loja)
  union all select s.ord, s.seq, s.linha
              from sql_das_linhas s
       ) z
 order by z.ord, z.seq;
