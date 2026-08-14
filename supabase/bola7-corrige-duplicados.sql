-- ============================================================================
--  BOLA 7 → conserta o estrago do bola7-pastas-refri-isotonico.sql
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  O QUE ACONTECEU
--  O script anterior foi escrito olhando o catálogo inicial (bola7-estoque.sql)
--  e não o banco de verdade. Nesse meio tempo o DONO já tinha cadastrado os
--  mesmos produtos pelo app, com a grafia dele ("Gatorade bluy", "Ks zero
--  290ml"...). A trava do insert era nome IDÊNTICO, então não pegou, e o
--  catálogo ficou com o produto dele e o meu, lado a lado.
--
--  O QUE ESTE SCRIPT FAZ
--   1) some com as DUPLICATAS QUE EU CRIEI (ativo = false, igual ao ✕ do app —
--      não apaga, só tira da tela). Os produtos DELE ficam, porque são os que
--      podem já ter contagem de estoque e venda no histórico.
--   2) leva os 7 produtos que ele cadastrou na pasta "Refrigerante" pras pastas
--      novas — é o que faz aquela pasta velha finalmente sumir.
--
--  TRAVA DE SEGURANÇA: se ele já tiver contado estoque em alguma duplicata
--  minha, ela NÃO é mexida e o script avisa. Nesse caso a gente decide na mão
--  qual das duas fica.
--
--  Idempotente, não apaga nada e não renomeia nada. Só a Bola 7.
-- ============================================================================

do $$
declare
  d_id     uuid;
  n_fora   int;
  n_pulou  int;
  n_mov    int;
  r        record;
begin
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Bola 7" nao encontrada.';
  end if;

  -- ==========================================================================
  --  1) TIRA DA TELA AS DUPLICATAS QUE EU CRIEI
  --     À esquerda o que eu inseri; à direita o produto DELE que já cobria.
  -- ==========================================================================
  create temporary table _dup (meu text, dele text) on commit drop;
  insert into _dup (meu, dele) values
    ('Gatorade Limão 500ml',     'Gatorade limão'),
    ('Gatorade Uva 500ml',       'Gatorade uva'),
    ('Gatorade Tangerina 500ml', 'Gatorade tangirina'),
    ('Gatorade Laranja 500ml',   'Gatorade laranja'),
    ('Gatorade Blue 500ml',      'Gatorade bluy'),
    ('Powerade Blue 500ml',      'Power ade bluy'),
    ('Coca Zero lata',           'Coca zero lata 310 ml'),
    ('Coca Zero KS 290ml',       'Ks zero 290ml'),
    ('Coca Zero LS 1 litro',     'Coca zero 1 litro retornável'),
    ('Pepsi Zero lata',          'Pepsi zero lata 350ml')
  ;

  -- só mexe no que está limpo: sem entrada de estoque e sem perda registrada
  update public.cervejas c
     set ativo = false
    from _dup d
   where c.distribuidora_id = d_id
     and c.nome = d.meu
     and c.ativo = true
     and not exists (select 1 from public.estoque_entradas e where e.cerveja_id = c.id)
     and not exists (select 1 from public.perdas p where p.cerveja_id = c.id);
  get diagnostics n_fora = row_count;

  -- avisa o que ficou de fora porque já tinha movimento
  n_pulou := 0;
  for r in
    select c.nome
      from public.cervejas c
      join _dup d on d.meu = c.nome
     where c.distribuidora_id = d_id
       and c.ativo = true
  loop
    n_pulou := n_pulou + 1;
    raise notice 'NAO MEXI em "%" — ja tem estoque contado ou perda. Decidir na mao qual fica.', r.nome;
  end loop;

  -- ==========================================================================
  --  2) OS 7 QUE ELE CRIOU NA PASTA VELHA "Refrigerante" VÃO PRAS PASTAS NOVAS
  -- ==========================================================================
  create temporary table _mover (nome text, pasta text) on commit drop;
  insert into _mover (nome, pasta) values
    ('Coca zero lata 310 ml',        'Refri lata'),
    ('Fanta uva lata 310ml',         'Refri lata'),
    ('Pepsi zero lata 350ml',        'Refri lata'),
    ('Guaraná zero 350 ml',          'Refri lata'),
    ('Fanta carmesim 310ml',         'Refri lata'),
    ('Ks zero 290ml',                'Refri retornável'),
    ('Coca zero 1 litro retornável', 'Refri retornável')
  ;

  update public.cervejas c
     set categoria = m.pasta
    from _mover m
   where c.distribuidora_id = d_id
     and c.nome = m.nome
     and c.categoria is distinct from m.pasta;
  get diagnostics n_mov = row_count;

  -- nome escrito diferente = update silencioso em nada. Melhor gritar.
  for r in
    select m.nome from _mover m
     where not exists (
       select 1 from public.cervejas c
        where c.distribuidora_id = d_id and c.nome = m.nome
     )
  loop
    raise notice 'ATENCAO: nao achei o produto "%" — confira o nome exato no app.', r.nome;
  end loop;

  raise notice 'Bola 7: % duplicata(s) fora da tela, % pulada(s), % trocaram de pasta.',
    n_fora, n_pulou, n_mov;
end $$;

-- ============================================================================
--  CONFERÊNCIA — como ficaram as pastas (a "Refrigerante" tem que sumir daqui)
-- ============================================================================
select coalesce(categoria, '(sem pasta)')    as pasta,
       count(*)                              as produtos,
       string_agg(nome, ', ' order by ordem)  as itens
  from public.cervejas
 where distribuidora_id = (select id from public.distribuidoras
                            where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7')
   and ativo = true
 group by 1
 order by 1;
