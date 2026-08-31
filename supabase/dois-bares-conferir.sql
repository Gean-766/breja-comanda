-- ============================================================================
--  CONFERIR OS DOIS BARES
--  Roda no Supabase, SQL Editor. E SOMENTE LEITURA: nao altera nada, pode
--  rodar com o bar vendendo, e pode rodar quantas vezes quiser.
--
--  Roda o arquivo INTEIRO de uma vez. Vem uma tabelinha com tres colunas:
--  o que foi conferido, o que deu, e se esta certo ou nao.
--
--  Use depois de cada passo, pra nao descobrir problema tres passos na frente.
-- ============================================================================

with bares as (
  select id, nome, login from public.distribuidoras
),
terreo as (select id from bares where login = 'bola7'),
cima   as (select id from bares where login = 'bola7cima'),

conferencias as (

  -- 1) A lista de acessos existe e tem gente dentro
  select 1 as ord,
         'Logins na lista de acessos' as conferindo,
         count(*)::text as resultado,
         case when count(*) > 0 then 'ok' else 'FALTA rodar o dono-varios-bares.sql' end as situacao
    from public.acessos

  -- 2) O bar de cima ja existe
  union all
  select 2,
         'O bar de cima existe',
         coalesce((select nome from bares where login = 'bola7cima'), 'nao achei'),
         case when exists (select 1 from cima) then 'ok'
              else 'FALTA criar no painel, com o login bola7cima' end

  -- 3) Produtos de cada bar (depois de copiar, os dois numeros batem)
  union all
  select 3,
         'Produtos no terreo',
         (select count(*)::text from public.cervejas
           where distribuidora_id = (select id from terreo) and ativo = true),
         'confira com a linha de baixo'

  union all
  select 4,
         'Produtos em cima',
         coalesce((select count(*)::text from public.cervejas
                    where distribuidora_id = (select id from cima) and ativo = true), '0'),
         case
           when not exists (select 1 from cima) then 'o bar de cima nem existe ainda'
           when (select count(*) from public.cervejas
                  where distribuidora_id = (select id from cima) and ativo = true) =
                (select count(*) from public.cervejas
                  where distribuidora_id = (select id from terreo) and ativo = true)
             then 'ok, bateu com o terreo'
           else 'FALTA rodar o copiar-produtos-entre-lojas.sql'
         end

  -- 4) O estoque de cima tem que nascer ZERADO, esperando a contagem
  union all
  select 5,
         'Contagens de estoque em cima',
         coalesce((select count(*)::text from public.estoque_entradas
                    where distribuidora_id = (select id from cima)), '0'),
         case
           when not exists (select 1 from cima) then 'o bar de cima nem existe ainda'
           when coalesce((select count(*) from public.estoque_entradas
                           where distribuidora_id = (select id from cima)), 0) = 0
             then 'ok, nasceu zerado como tem que ser'
           else 'ATENCAO: veio estoque junto, nao era pra ter vindo'
         end

  -- 5) O perigo: login alcancando dois bares com o app velho em producao
  union all
  select 6,
         'Logins que alcancam mais de um bar',
         (select count(*)::text from (
            select auth_user_id from public.acessos
             group by auth_user_id having count(*) > 1) x),
         case when (select count(*) from (
                      select auth_user_id from public.acessos
                       group by auth_user_id having count(*) > 1) y) = 0
              then 'nenhum ainda, seguro pro app de producao'
              else 'so use esses logins no endereco de TESTE ate o app novo subir'
         end
)
select conferindo, resultado, situacao from conferencias order by ord;
