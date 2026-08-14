-- ============================================================================
--  BOLA 7 → tira o nome dobrado ("Heineken 600ml 600ml" → "Heineken 600ml")
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  O PROBLEMA
--  O catálogo inicial gravou o tamanho DUAS vezes: dentro do nome
--  ("Heineken 600ml") e no campo `tamanho` ("600ml"). Na hora de lançar, o app
--  junta os dois, então a venda vira "Heineken 600ml 600ml". Isso aparece na
--  lista da comanda, no CUPOM IMPRESSO e no "Mais vendidos" do relatório.
--  63 dos 107 produtos estão assim.
--
--  A CORREÇÃO
--  Zerar o campo `tamanho` (o nome já diz o formato). Só que o saldo de
--  estoque casa a saída pelo NOME, então zerar sozinho faria as vendas antigas
--  pararem de descontar e o estoque subir. Por isso os dois passos vão JUNTOS,
--  nesta ordem:
--    1) reescreve o que já foi vendido/perdido pro nome novo
--    2) só então zera o `tamanho`
--
--  Nenhum produto é apagado e nenhum NOME de produto muda — o que muda é o
--  campo `tamanho`, que estava repetindo o que o nome já dizia.
--
--  MOMENTO CERTO: quanto menos venda registrada, menos histórico pra
--  reescrever. Idempotente. Só a Bola 7.
-- ============================================================================

do $$
declare
  d_id     uuid;
  n_dup    int;
  n_cons   int;
  n_perda  int;
  n_prod   int;
  r        record;
begin
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Bola 7" nao encontrada.';
  end if;

  -- ---------------------------------------------------------------------
  -- 0) TRAVA: se dois produtos ficariam com o mesmo nome depois disto, eles
  --    passariam a dividir o mesmo saldo. Aí é melhor não mexer em nada.
  -- ---------------------------------------------------------------------
  select count(*) into n_dup from (
    select nome from public.cervejas
     where distribuidora_id = d_id and ativo = true
     group by nome having count(*) > 1
  ) x;
  if n_dup > 0 then
    for r in
      select nome from public.cervejas
       where distribuidora_id = d_id and ativo = true
       group by nome having count(*) > 1
    loop
      raise notice 'CONFLITO: existe mais de um produto ativo chamado "%".', r.nome;
    end loop;
    raise exception 'Nao mexi em nada: % nome(s) ficariam repetidos.', n_dup;
  end if;

  -- ---------------------------------------------------------------------
  -- 1) O histórico passa a usar o nome novo (ANTES de zerar o tamanho, senão
  --    perdemos a informação de como o nome antigo era montado)
  -- ---------------------------------------------------------------------
  update public.consumos c
     set beer_nome = p.nome
    from public.cervejas p
   where c.distribuidora_id = d_id
     and p.distribuidora_id = d_id
     and p.tamanho is not null and p.tamanho <> ''
     and c.beer_nome = p.nome || ' ' || p.tamanho;
  get diagnostics n_cons = row_count;

  update public.perdas pe
     set beer_nome = p.nome
    from public.cervejas p
   where pe.distribuidora_id = d_id
     and p.distribuidora_id = d_id
     and p.tamanho is not null and p.tamanho <> ''
     and pe.beer_nome = p.nome || ' ' || p.tamanho;
  get diagnostics n_perda = row_count;

  -- ---------------------------------------------------------------------
  -- 2) Agora sim: zera o tamanho repetido
  -- ---------------------------------------------------------------------
  update public.cervejas
     set tamanho = ''
   where distribuidora_id = d_id
     and tamanho is not null and tamanho <> '';
  get diagnostics n_prod = row_count;

  raise notice 'Bola 7: % produto(s) limpos, % venda(s) e % perda(s) reescritas.',
    n_prod, n_cons, n_perda;
end $$;

-- ============================================================================
--  CONFERÊNCIA 1 — nenhum produto pode sobrar com tamanho preenchido
-- ============================================================================
select nome, tamanho
  from public.cervejas
 where distribuidora_id = (select id from public.distribuidoras
                            where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7')
   and ativo = true
   and tamanho is not null and tamanho <> '';

-- ============================================================================
--  CONFERÊNCIA 2 — como os nomes ficaram no histórico de vendas.
--  Toda linha aqui tem que bater com um produto do cadastro (coluna "casa").
-- ============================================================================
select c.beer_nome,
       sum(c.quantidade) as unidades,
       case when exists (
         select 1 from public.cervejas p
          where p.distribuidora_id = c.distribuidora_id and p.nome = c.beer_nome
       ) then 'ok' else 'ORFAO — nao desconta do estoque' end as casa
  from public.consumos c
 where c.distribuidora_id = (select id from public.distribuidoras
                              where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7')
 group by c.beer_nome, c.distribuidora_id
 order by 3 desc, 1;
