-- ============================================================================
--  CONFERE O BACKUP - conta o que TINHA que estar no arquivo
--  Roda no Supabase, SQL Editor. E SOMENTE LEITURA.
--
--  PRA QUE SERVE
--  Depois de gerar o backup pelo backup-gera-restauracao.sql, ou de baixar
--  pelo botao do painel CEO, roda esta consulta. Ela diz quantas linhas cada
--  tabela tem. O numero de linhas do arquivo baixado tem que bater com o
--  TOTAL daqui, mais 1 do comentario de cabecalho.
--
--  Se nao bater, o arquivo esta cortado. Isso acontece calado: o PostgREST
--  devolve no maximo 1000 linhas por vez, e um backup que passou do limite
--  desce pela metade sem avisar ninguem.
--
--  Nao pule este passo. E a diferenca entre TER um backup e ACHAR que tem.
--
--  Troque bola7 na primeira linha pelo login da loja. E o unico lugar.
-- ============================================================================

with loja as (

  -- >>>>>>>>>>  O UNICO LUGAR PRA MEXER
  select id from public.distribuidoras where login = 'bola7'

),
contagem as (
            select  1 as ord, 'distribuidoras'      as tabela, count(*) as linhas
              from public.distribuidoras      where id               = (select id from loja)
  union all select  2, 'pagamentos',          count(*)
              from public.pagamentos          where distribuidora_id = (select id from loja)
  union all select  3, 'caixas',              count(*)
              from public.caixas              where distribuidora_id = (select id from loja)
  union all select  4, 'cervejas',            count(*)
              from public.cervejas            where distribuidora_id = (select id from loja)
  union all select  5, 'estoque_entradas',    count(*)
              from public.estoque_entradas    where distribuidora_id = (select id from loja)
  union all select  6, 'clientes',            count(*)
              from public.clientes            where distribuidora_id = (select id from loja)
  union all select  7, 'consumos',            count(*)
              from public.consumos            where distribuidora_id = (select id from loja)
  union all select  8, 'pagamentos_parciais', count(*)
              from public.pagamentos_parciais where distribuidora_id = (select id from loja)
  union all select  9, 'perdas',              count(*)
              from public.perdas              where distribuidora_id = (select id from loja)
  union all select 10, 'historico',           count(*)
              from public.historico           where distribuidora_id = (select id from loja)
)
select x.tabela, x.linhas
  from (
            select ord, tabela, linhas::numeric from contagem
  union all select 99, 'TOTAL (o arquivo baixado tem isto mais 1 de cabecalho)', sum(linhas)
              from contagem
       ) x
 order by x.ord;
