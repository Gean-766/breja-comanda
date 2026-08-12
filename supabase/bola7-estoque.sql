-- ============================================================================
--  BOLA 7  →  Catálogo/estoque inicial (83 produtos) COM FOTO
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  Seguro e IDEMPOTENTE: só adiciona o que ainda não existe pra Bola 7 e
--  preenche a foto de quem entrou sem ela (rodar de novo não duplica e não
--  sobrescreve foto já existente). Preços entram como R$ 0,00 — o lojista
--  ajusta preço/custo/unid. na aba "Cadastrar" do app dele.
--
--  As fotos ficam dentro do app (/public/produtos), servidas pela Vercel.
-- ============================================================================

-- Coluna de foto do produto (aditivo)
alter table public.cervejas add column if not exists foto text;

do $$
declare
  d_id uuid;
  n    int;
  m    int;
begin
  -- acha o Bola 7 pelo NOME normalizado (ignora espaço/maiúscula: "Bola 7", "bola7"...)
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Bola 7" nao encontrada. Confira em: select nome from distribuidoras;';
  end if;

  create temporary table _bola7 (nome text, tamanho text, categoria text, foto text, ordem int) on commit drop;
  insert into _bola7 (nome, tamanho, categoria, foto, ordem) values
    ('Heineken 600ml','600ml','Cerveja','/produtos/heineken-600ml.png',0),
    ('Corona 600ml','600ml','Cerveja','/produtos/corona-600ml.png',1),
    ('Stella 600ml','600ml','Cerveja','/produtos/stella-600ml.png',2),
    ('Stella Gold 600ml','600ml','Cerveja','/produtos/stella-gold-600ml.png',3),
    ('Spaten 600ml','600ml','Cerveja','/produtos/spaten-600ml.png',4),
    ('Brahma 600ml','600ml','Cerveja','/produtos/brahma-600ml.png',5),
    ('Original 600ml','600ml','Cerveja','/produtos/original-600ml.png',6),
    ('Antártica 600ml','600ml','Cerveja','/produtos/antartica-600ml.png',7),
    ('Budweiser 600ml','600ml','Cerveja','/produtos/budweiser-600ml.png',8),
    ('Skol 600ml','600ml','Cerveja','/produtos/skol-600ml.png',9),
    ('Heineken 330','Long neck 330','Cerveja','/produtos/heineken-330.png',10),
    ('Corona 330','Long neck 330','Cerveja','/produtos/corona-330.png',11),
    ('Stella 330','Long neck 330','Cerveja','/produtos/stella-330.png',12),
    ('Stella Gold 330','Long neck 330','Cerveja','/produtos/stella-gold-330.png',13),
    ('Spaten 330','Long neck 330','Cerveja','/produtos/spaten-330.png',14),
    ('Budweiser 330','Long neck 330','Cerveja','/produtos/budweiser-330.png',15),
    ('Michelob Ultra 330','Long neck 330','Cerveja','/produtos/michelob-ultra-330.png',16),
    ('Flying Fish 330','Long neck 330','Cerveja','/produtos/flying-fish-330.png',17),
    ('Corona 330 Zero','Long neck zero','Cerveja','/produtos/corona-330-zero.png',18),
    ('Heineken 330 Zero','Long neck zero','Cerveja','/produtos/heineken-330-zero.png',19),
    ('Brahma 300','300ml','Cerveja','/produtos/brahma-300.png',20),
    ('Original 300','300ml','Cerveja','/produtos/original-300.png',21),
    ('Antártica 300','300ml','Cerveja','/produtos/antartica-300.png',22),
    ('Brahma 269','Lata 269','Cerveja','/produtos/brahma-269.png',23),
    ('Original 269','Lata 269','Cerveja','/produtos/original-269.png',24),
    ('Antártica 269','Lata 269','Cerveja','/produtos/antartica-269.png',25),
    ('Skol 269','Lata 269','Cerveja','/produtos/skol-269.png',26),
    ('Spaten 269','Lata 269','Cerveja','/produtos/spaten-269.png',27),
    ('Heineken 269','Lata 269','Cerveja','/produtos/heineken-269.png',28),
    ('Stella 269','Lata 269','Cerveja','/produtos/stella-269.png',29),
    ('Guaraná 1 litro','1 litro','Refrigerante','/produtos/guarana-1-litro.png',30),
    ('Pepsi 1 litro','1 litro','Refrigerante','/produtos/pepsi-1-litro.png',31),
    ('Guaraná 600ml','600ml','Refrigerante','/produtos/guarana-600ml.png',32),
    ('Coca lata','Lata','Refrigerante','/produtos/coca-lata.png',33),
    ('Fanta lata','Lata','Refrigerante','/produtos/fanta-lata.png',34),
    ('Jesus lata','Lata','Refrigerante','/produtos/jesus-lata.png',35),
    ('Guaraná lata','Lata','Refrigerante','/produtos/guarana-lata.png',36),
    ('Sukita lata','Lata','Refrigerante','/produtos/sukita-lata.png',37),
    ('Sprite lata','Lata','Refrigerante','/produtos/sprite-lata.png',38),
    ('Schweppes lata','Lata','Refrigerante','/produtos/schweppes-lata.png',39),
    ('Pepsi lata','Lata','Refrigerante','/produtos/pepsi-lata.png',40),
    ('Coca KS 290ml','KS 290ml','Refrigerante','/produtos/coca-ks-290ml.png',41),
    ('Fanta KS 290ml','KS 290ml','Refrigerante','/produtos/fanta-ks-290ml.png',42),
    ('Coca 1 litro','1 litro','Refrigerante','/produtos/coca-1-litro.png',43),
    ('Coca 2 litros','2 litros','Refrigerante','/produtos/coca-2-litros.png',44),
    ('Fanta 2 litros','2 litros','Refrigerante','/produtos/fanta-2-litros.png',45),
    ('Guaraná 2 litros','2 litros','Refrigerante','/produtos/guarana-2-litros.png',46),
    ('Tubaína 600ml','600ml','Refrigerante','/produtos/tubaina-600ml.png',47),
    ('Kapo','Suco','Suco','/produtos/kapo.png',48),
    ('Delvale 269ml','269ml','Suco','/produtos/delvale-269ml.png',49),
    ('Monster 473ml','473ml','Energético','/produtos/monster-473ml.png',50),
    ('Red Bull 250ml','250ml','Energético','/produtos/red-bull-250ml.png',51),
    ('H20 500ml','500ml','Água','/produtos/h20-500ml.png',52),
    ('H20 lata 350ml','Lata 350ml','Água','/produtos/h20-lata-350ml.png',53),
    ('Gatorade 500ml','500ml','Água','/produtos/gatorade-500ml.png',54),
    ('Água 497ml','497ml','Água','/produtos/agua-497ml.png',55),
    ('Ruffles','','Salgadinho','/produtos/ruffles.png',56),
    ('Doritos','','Salgadinho','/produtos/doritos.png',57),
    ('Cheetos','','Salgadinho','/produtos/cheetos.png',58),
    ('Torresmo pururuca','','Salgadinho','/produtos/torresmo-pururuca.png',59),
    ('Torcida','','Salgadinho','/produtos/torcida.png',60),
    ('Pimenta real','','Salgadinho','/produtos/pimenta-real.png',61),
    ('Sanditos','','Salgadinho','/produtos/sanditos.png',62),
    ('Halls','','Outros','/produtos/halls.png',63),
    ('Tridente','','Outros','/produtos/tridente.png',64),
    ('Todinho 200ml','200ml','Outros','/produtos/todinho-200ml.png',65),
    ('Compare','Dose','Dose','/produtos/compare.png',66),
    ('Old Par','Dose','Dose','/produtos/old-par.png',67),
    ('Cavalo Branco','Dose','Dose','/produtos/cavalo-branco.png',68),
    ('Red Label','Dose','Dose','/produtos/red-label.png',69),
    ('51','Dose','Dose','/produtos/51.png',70),
    ('Velho Barreiro','Dose','Dose','/produtos/velho-barreiro.png',71),
    ('Mini torta','','Sorvete','/produtos/mini-torta.png',72),
    ('Iogurte 4','','Sorvete','/produtos/iogurte-4.png',73),
    ('Picolé 5','','Sorvete','/produtos/picole.png',74),
    ('Picolé 8','','Sorvete','/produtos/picole.png',75),
    ('Picolé 10','','Sorvete','/produtos/picole.png',76),
    ('Picolé 11','','Sorvete','/produtos/picole.png',77),
    ('Picolé 12','','Sorvete','/produtos/picole.png',78),
    ('Picolé 14','','Sorvete','/produtos/picole.png',79),
    ('Picolé 15','','Sorvete','/produtos/picole.png',80),
    ('Picolé 18','','Sorvete','/produtos/picole.png',81),
    ('Pote de sorvete 30','','Sorvete','/produtos/pote-de-sorvete-30.png',82)
  ;

  -- 1) insere só o que ainda não existe pra Bola 7
  insert into public.cervejas (nome, tamanho, preco, categoria, foto, ordem, ativo, distribuidora_id)
  select nv.nome, nv.tamanho, 0, nv.categoria, nv.foto, nv.ordem, true, d_id
    from _bola7 nv
   where not exists (
     select 1 from public.cervejas c
      where c.distribuidora_id = d_id and c.nome = nv.nome
   );
  get diagnostics n = row_count;

  -- 2) preenche a foto de quem já existe mas está sem (ex: Spaten 600 que entrou sem foto)
  update public.cervejas c
     set foto = nv.foto
    from _bola7 nv
   where c.distribuidora_id = d_id
     and c.nome = nv.nome
     and nv.foto is not null
     and (c.foto is null or c.foto = '');
  get diagnostics m = row_count;

  raise notice 'Bola 7 (%): % produtos novos, % fotos preenchidas.', d_id, n, m;
end $$;

-- Confere:  select nome, tamanho, categoria, foto, preco from cervejas
--            where distribuidora_id = (select id from distribuidoras
--            where lower(regexp_replace(nome,'[^a-zA-Z0-9]','','g'))='bola7')
--            order by ordem;
