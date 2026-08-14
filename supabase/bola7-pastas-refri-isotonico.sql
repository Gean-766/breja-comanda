-- ============================================================================
--  BOLA 7 → Reorganização das pastas + produtos novos (refri, isotônico, água)
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  NÃO APAGA NADA e NÃO RENOMEIA NADA. O estoque que o dono já levantou fica
--  intacto, e por um motivo técnico que importa: o saldo casa a saída pelo NOME
--  do produto (consumos.beer_nome). Trocar o nome de um produto existente
--  quebraria esse casamento e o saldo dele subiria sozinho. Por isso aqui só
--  mexe em DUAS coisas:
--    1) `categoria`  → a pasta em que o produto aparece (puro visual)
--    2) INSERT       → produtos que ainda não existem
--
--  É idempotente: rodar de novo não duplica e não desfaz nada.
--  Só toca na Bola 7; nenhuma outra loja é afetada.
--
--  ---------------------------------------------------------------------------
--  O QUE MUDA (pedido do dono, 14/08/2026)
--
--  A pasta "Refrigerante" tinha 18 itens misturados — lata, garrafa PET e
--  retornável no mesmo bolo. Vira três, do jeito que ele compra e pede:
--      🥫 Refri lata        · as latas
--      🧴 Refri PET         · descartável de 600ml, 1 e 2 litros
--      ♻️ Refri retornável  · KS e LS (os de vidro que voltam)
--
--  Isotônico sai da Água e vai pra Energético, junto de Red Bull e Monster,
--  e passa a ter um item por SABOR — que é o ponto do pedido: com um
--  "Gatorade" só, ele vê saldo bom no app e chega no estoque e só tem laranja.
--
--  Mesma ideia no refrigerante: Coca normal e Coca Zero viram itens separados,
--  senão não dá pra saber qual das duas está acabando.
--
--  A pasta 🛒 Comprar é pra o que ele NÃO tem mas o cliente pede (Pepsi Zero e
--  companhia). Vai com um item só pra pasta nascer; o resto ele mesmo põe pelo
--  "+ Adicionar produto" dentro dela.
-- ============================================================================

do $$
declare
  d_id    uuid;
  n_mov   int;
  n_novo  int;
  prox    int;
begin
  -- acha o Bola 7 pelo NOME normalizado (ignora espaço/maiúscula)
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Bola 7" nao encontrada. Confira em: select nome from distribuidoras;';
  end if;

  -- ==========================================================================
  --  1) TROCA DE PASTA — só a coluna `categoria`. Nome, preço, custo e
  --     entradas de estoque ficam exatamente como estão.
  -- ==========================================================================
  create temporary table _mover (nome text, pasta text) on commit drop;
  insert into _mover (nome, pasta) values
    -- isotônico: sai da Água, entra em Energético (com Red Bull e Monster)
    ('Gatorade 500ml',   'Energético'),

    -- latas
    ('Coca lata',        'Refri lata'),
    ('Fanta lata',       'Refri lata'),
    ('Jesus lata',       'Refri lata'),
    ('Guaraná lata',     'Refri lata'),
    ('Sukita lata',      'Refri lata'),
    ('Sprite lata',      'Refri lata'),
    ('Schweppes lata',   'Refri lata'),
    ('Pepsi lata',       'Refri lata'),

    -- PET descartável (600ml, 1 e 2 litros)
    ('Guaraná 600ml',    'Refri PET'),
    ('Tubaína 600ml',    'Refri PET'),
    ('Guaraná 1 litro',  'Refri PET'),
    ('Pepsi 1 litro',    'Refri PET'),
    ('Coca 1 litro',     'Refri PET'),
    ('Coca 2 litros',    'Refri PET'),
    ('Fanta 2 litros',   'Refri PET'),
    ('Guaraná 2 litros', 'Refri PET'),

    -- retornável (vidro que volta)
    ('Coca KS 290ml',    'Refri retornável'),
    ('Fanta KS 290ml',   'Refri retornável')
  ;

  update public.cervejas c
     set categoria = m.pasta
    from _mover m
   where c.distribuidora_id = d_id
     and c.nome = m.nome
     and c.categoria is distinct from m.pasta;
  get diagnostics n_mov = row_count;

  -- ==========================================================================
  --  2) PRODUTOS NOVOS
  --     `preco_de` = de qual produto já cadastrado copiar o preço. Um sabor
  --     novo custa o mesmo do irmão que já está na casa, então ele nasce com o
  --     preço certo em vez de R$ 0,00 (produto a zero é venda de graça se o
  --     garçom lançar antes de o dono passar o preço).
  --     A quantidade NÃO entra aqui: quem conta o estoque é ele, no app.
  -- ==========================================================================
  select coalesce(max(ordem), 0) into prox
    from public.cervejas where distribuidora_id = d_id;

  create temporary table _novo (nome text, pasta text, foto text, preco_de text, seq int) on commit drop;
  insert into _novo (nome, pasta, foto, preco_de, seq) values
    -- isotônicos por sabor (a foto é a do Gatorade que já existe — genérica;
    -- dá pra trocar depois por uma de cada sabor)
    ('Gatorade Limão 500ml',     'Energético', '/produtos/gatorade-500ml.png', 'Gatorade 500ml',  1),
    ('Gatorade Uva 500ml',       'Energético', '/produtos/gatorade-500ml.png', 'Gatorade 500ml',  2),
    ('Gatorade Tangerina 500ml', 'Energético', '/produtos/gatorade-500ml.png', 'Gatorade 500ml',  3),
    ('Gatorade Laranja 500ml',   'Energético', '/produtos/gatorade-500ml.png', 'Gatorade 500ml',  4),
    ('Gatorade Blue 500ml',      'Energético', '/produtos/gatorade-500ml.png', 'Gatorade 500ml',  5),
    ('Powerade Blue 500ml',      'Energético', null,                           'Gatorade 500ml',  6),

    -- águas (sem tamanho: ele não disse o ml — dá pra ajustar no app depois)
    ('Água com gás',             'Água',       null,                           'Água 497ml',      7),
    ('Água sem gás',             'Água',       '/produtos/agua-497ml.png',     'Água 497ml',      8),

    -- zero separado do normal, senão não dá pra saber qual está acabando
    ('Coca Zero lata',           'Refri lata', null,                           'Coca lata',       9),

    -- retornáveis que faltavam
    ('Coca Zero KS 290ml',       'Refri retornável', null,                     'Coca KS 290ml',  10),
    ('Coca LS 1 litro',          'Refri retornável', null,                     'Coca 1 litro',   11),
    ('Coca Zero LS 1 litro',     'Refri retornável', null,                     'Coca 1 litro',   12),

    -- o que ele não tem mas o cliente pede
    ('Pepsi Zero lata',          'Comprar',    null,                           'Pepsi lata',     13)
  ;

  insert into public.cervejas (nome, tamanho, preco, categoria, foto, ordem, ativo, distribuidora_id)
  select nv.nome,
         '',                       -- tudo no nome (é assim que o app cadastra)
         coalesce((select r.preco
                     from public.cervejas r
                    where r.distribuidora_id = d_id
                      and r.nome = nv.preco_de
                    order by r.ativo desc
                    limit 1), 0),
         nv.pasta,
         nv.foto,
         prox + nv.seq,
         true,
         d_id
    from _novo nv
   where not exists (
     select 1 from public.cervejas c
      where c.distribuidora_id = d_id and c.nome = nv.nome
   );
  get diagnostics n_novo = row_count;

  raise notice 'Bola 7 (%): % produto(s) trocaram de pasta, % produto(s) novos.', d_id, n_mov, n_novo;
end $$;

-- ============================================================================
--  CONFERÊNCIA — como ficaram as pastas
-- ============================================================================
select coalesce(categoria, '(sem pasta)') as pasta,
       count(*)                           as produtos,
       string_agg(nome, ', ' order by ordem) as itens
  from public.cervejas
 where distribuidora_id = (select id from public.distribuidoras
                            where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7')
   and ativo = true
 group by 1
 order by 1;
