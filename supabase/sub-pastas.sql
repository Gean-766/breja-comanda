-- ============================================================================
--  SUB-PASTAS (2º nível do catálogo)  +  classificação da Bola 7
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  Pra quê: a pasta "Cerveja" tem 35 itens numa lista só. Agora ela abre em
--  600ml, Long neck 330, 300ml, Lata 269… A pasta continua sendo `categoria`;
--  o 2º nível é a coluna nova `subcategoria`.
--
--  Produto SEM sub-pasta fica solto dentro da pasta, de propósito: pasta
--  pequena (Dose... na verdade essa tem, mas Suco, Salgadinho, Outros não)
--  não ganha um nível a mais só pra ter. Um toque a mais no meio do movimento
--  tem que pagar por si.
--
--  NÃO APAGA e NÃO RENOMEIA nada — mexe só na coluna nova. O estoque
--  levantado continua intacto (o saldo casa a saída pelo NOME do produto,
--  e nenhum nome é tocado aqui).
--
--  O casamento do nome ignora maiúscula e espaço repetido, senão
--  "Cerveja zero Brahma  lata" (dois espaços) não seria encontrado.
--  Idempotente. Só a Bola 7.
-- ============================================================================

-- 1) A coluna nova (aditiva; o app já sabe funcionar com e sem ela)
alter table public.cervejas
  add column if not exists subcategoria text;

-- 2) Classificação
do $$
declare
  d_id   uuid;
  n_ok   int;
  r      record;
begin
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Bola 7" nao encontrada.';
  end if;

  create temporary table _sub (nome text, sub text) on commit drop;
  insert into _sub (nome, sub) values
    -- ---------------- CERVEJA (35) ----------------
    ('Heineken 600ml','600ml'), ('Corona 600ml','600ml'), ('Stella 600ml','600ml'),
    ('Stella Gold 600ml','600ml'), ('Spaten 600ml','600ml'), ('Brahma 600ml','600ml'),
    ('Original 600ml','600ml'), ('Antártica 600ml','600ml'), ('Budweiser 600ml','600ml'),
    ('Skol 600ml','600ml'),

    ('Heineken 330','Long neck 330'), ('Corona 330','Long neck 330'),
    ('Stella 330','Long neck 330'), ('Stella Gold 330','Long neck 330'),
    ('Spaten 330','Long neck 330'), ('Budweiser 330','Long neck 330'),
    ('Michelob Ultra 330','Long neck 330'), ('Flying Fish 330','Long neck 330'),
    ('Corona 330 Zero','Long neck 330'), ('Heineken 330 Zero','Long neck 330'),

    ('Brahma 300','300ml'), ('Original 300','300ml'), ('Antártica 300','300ml'),

    ('Brahma 269','Lata 269'), ('Original 269','Lata 269'), ('Antártica 269','Lata 269'),
    ('Skol 269','Lata 269'), ('Spaten 269','Lata 269'), ('Heineken 269','Lata 269'),
    ('Stella 269','Lata 269'),

    ('Cerveja zero Brahma  lata','Lata 350'), ('Flying fish lata 350ml','Lata 350'),

    ('Long brutall fruit','Ice'), ('Ace 51 limão','Ice'),
    -- Caracu fica solta: é a única do tipo, não vale uma pasta só pra ela

    -- ---------------- ÁGUA (6) ----------------
    ('Água com gás','Com gás'),
    ('Água sem gás','Sem gás'), ('Água 497ml','Sem gás'),
    ('H20 500ml','H2O'), ('H20 lata 350ml','H2O'), ('H2O limão 500ml','H2O'),

    -- ---------------- DOSE (6) ----------------
    ('Compare','Whisky'), ('Old Par','Whisky'), ('Cavalo Branco','Whisky'),
    ('Red Label','Whisky'),
    ('51','Cachaça'), ('Velho Barreiro','Cachaça'),

    -- ---------------- ENERGÉTICO (9) ----------------
    ('Monster 473ml','Energético'), ('Red Bull 250ml','Energético'),
    ('Power ade bluy','Isotônico'), ('Gatorade bluy','Isotônico'),
    ('Gatorade moran, maracuja','Isotônico'), ('Gatorade tangirina','Isotônico'),
    ('Gatorade laranja','Isotônico'), ('Gatorade uva','Isotônico'),
    ('Gatorade limão','Isotônico'),

    -- ---------------- REFRI LATA (13) ----------------
    ('Coca lata','Normal'), ('Fanta lata','Normal'), ('Jesus lata','Normal'),
    ('Guaraná lata','Normal'), ('Sukita lata','Normal'), ('Sprite lata','Normal'),
    ('Schweppes lata','Normal'), ('Pepsi lata','Normal'),
    ('Fanta uva lata 310ml','Normal'), ('Fanta carmesim 310ml','Normal'),
    ('Coca zero lata 310 ml','Zero'), ('Pepsi zero lata 350ml','Zero'),
    ('Guaraná zero 350 ml','Zero'),

    -- ---------------- REFRI PET (8) ----------------
    ('Guaraná 600ml','600ml'), ('Tubaína 600ml','600ml'),
    ('Guaraná 1 litro','1 litro'), ('Pepsi 1 litro','1 litro'), ('Coca 1 litro','1 litro'),
    ('Coca 2 litros','2 litros'), ('Fanta 2 litros','2 litros'), ('Guaraná 2 litros','2 litros'),

    -- ---------------- REFRI RETORNÁVEL (5) ----------------
    ('Coca KS 290ml','KS 290ml'), ('Fanta KS 290ml','KS 290ml'), ('Ks zero 290ml','KS 290ml'),
    ('Coca LS 1 litro','LS 1 litro'), ('Coca zero 1 litro retornável','LS 1 litro'),

    -- ---------------- SORVETE (11) ----------------
    ('Picolé 5','Picolé'), ('Picolé 8','Picolé'), ('Picolé 10','Picolé'),
    ('Picolé 11','Picolé'), ('Picolé 12','Picolé'), ('Picolé 14','Picolé'),
    ('Picolé 15','Picolé'), ('Picolé 18','Picolé')
    -- Mini torta, Pote de sorvete 30 e Iogurte 4 ficam soltos
  ;

  update public.cervejas c
     set subcategoria = s.sub
    from _sub s
   where c.distribuidora_id = d_id
     and lower(regexp_replace(c.nome, '\s+', ' ', 'g')) =
         lower(regexp_replace(s.nome, '\s+', ' ', 'g'))
     and c.subcategoria is distinct from s.sub;
  get diagnostics n_ok = row_count;

  -- nome que não bateu = produto que ficaria solto sem ninguém perceber
  for r in
    select s.nome from _sub s
     where not exists (
       select 1 from public.cervejas c
        where c.distribuidora_id = d_id
          and lower(regexp_replace(c.nome, '\s+', ' ', 'g')) =
              lower(regexp_replace(s.nome, '\s+', ' ', 'g'))
     )
  loop
    raise notice 'ATENCAO: nao achei "%" — esse produto vai ficar solto na pasta.', r.nome;
  end loop;

  raise notice 'Bola 7: % produto(s) ganharam sub-pasta.', n_ok;
end $$;

-- ============================================================================
--  CONFERÊNCIA — pasta › sub-pasta
-- ============================================================================
select categoria                                as pasta,
       coalesce(subcategoria, '— (solto)')      as sub_pasta,
       count(*)                                 as produtos,
       string_agg(nome, ', ' order by ordem)     as itens
  from public.cervejas
 where distribuidora_id = (select id from public.distribuidoras
                            where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7')
   and ativo = true
 group by 1, 2
 order by 1, 2;
