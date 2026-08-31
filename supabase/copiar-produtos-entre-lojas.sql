-- ============================================================================
--  COPIAR A LISTA DE PRODUTOS DE UMA LOJA PRA OUTRA
--  Roda no Supabase, SQL Editor.
--
--  PRA QUE SERVE
--  O bar de cima do Bola 7 vende quase a mesma coisa do bar de baixo. Sao 107
--  produtos, com preco, pasta, sub-pasta e foto. Cadastrar tudo de novo na mao
--  e uma noite inteira de trabalho e um monte de erro de digitacao.
--
--  ------------------------------------------------------------------------
--  O QUE ELE COPIA E O QUE ELE NAO COPIA
--  ------------------------------------------------------------------------
--  COPIA: nome, tamanho, preco, cor, ordem, pasta, sub-pasta, foto, custo da
--  caixa, unidades por caixa, alerta de estoque minimo, se vai pra cozinha.
--  Copia tudo, inclusive coluna que for criada depois deste arquivo.
--
--  NAO COPIA: o ESTOQUE. E o ponto principal. Cada bar tem o estoque dele, e
--  o de cima comeca zerado, esperando a primeira contagem. Se o estoque
--  viesse junto, o bar de cima nasceria dizendo que tem 200 Brahmas que nunca
--  entraram la.
--
--  NAO COPIA tambem: vendas, comandas, caixas, perdas. Nada de movimento.
--
--  ------------------------------------------------------------------------
--  PODE RODAR DUAS VEZES
--  ------------------------------------------------------------------------
--  Produto que ja existe no destino, com o mesmo nome e tamanho, e pulado.
--  Entao se voce rodar de novo depois de cadastrar mais coisa embaixo, ele
--  leva so o que faltava. Nao duplica.
--
--  As fotos NAO sao copiadas de arquivo: as duas lojas passam a apontar pro
--  mesmo arquivo la no Storage. E de proposito, e a foto da Brahma e a mesma
--  nos dois andares. Cuidado com isso: trocar a foto de um produto no bar de
--  baixo troca a do de cima tambem.
-- ============================================================================

with origem as (

  -- >>>>>>>>>>  DE ONDE VEM (o bar que ja tem os produtos)
  select id from public.distribuidoras where login = 'bola7'

),
destino as (

  -- >>>>>>>>>>  PRA ONDE VAI (o bar novo, que esta vazio)
  select id from public.distribuidoras where login = 'bola7cima'

)
insert into public.cervejas
select (jsonb_populate_record(
          null::public.cervejas,
          -- pega a linha inteira do produto e troca so as tres coisas que NAO
          -- podem ser iguais: o id, o dono e a data de criacao. Feito assim,
          -- e nao com uma lista de colunas escrita na mao, coluna nova entra
          -- sozinha na copia em vez de ficar de fora calada.
          to_jsonb(c) || jsonb_build_object(
            'id',               gen_random_uuid(),
            'distribuidora_id', (select id from destino),
            'created_at',       now()
          )
        )).*
  from public.cervejas c
 where c.distribuidora_id = (select id from origem)
   and c.ativo = true
   and not exists (
         select 1
           from public.cervejas j
          where j.distribuidora_id = (select id from destino)
            and j.nome = c.nome
            and coalesce(j.tamanho, '') = coalesce(c.tamanho, '')
       );

-- ####  FIM  ####
--
-- DEU CERTO? Rode o dois-bares-conferir.sql: ele conta os produtos dos dois
-- bares (tem que dar o mesmo numero) e confere que o estoque de cima nasceu
-- zerado, esperando a primeira contagem.
