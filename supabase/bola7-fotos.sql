-- ============================================================================
--  BOLA 7 → fotos dos produtos que o dono cadastrou pelo app
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  As imagens já estão no app (breja-comanda/public/produtos). Isto aqui só
--  aponta cada produto pra sua foto. NÃO apaga, NÃO renomeia e NÃO mexe em
--  preço nem em estoque — só a coluna `foto`.
--
--  O casamento do nome ignora maiúscula e espaço repetido (tem produto com
--  espaço duplo no nome). Idempotente. Só a Bola 7.
-- ============================================================================

do $$
declare
  d_id uuid;
  n    int;
  r    record;
begin
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Bola 7" nao encontrada.';
  end if;

  create temporary table _foto (nome text, foto text) on commit drop;
  insert into _foto (nome, foto) values
    ('H2O limão 500ml', '/produtos/h2o-limao-500ml.png'),
    ('Água com gás', '/produtos/agua-com-gas.png'),
    ('Cerveja zero Brahma  lata', '/produtos/cerveja-zero-brahma-lata.png'),
    ('Flying fish lata 350ml', '/produtos/flying-fish-lata-350ml.png'),
    ('Long brutall fruit', '/produtos/long-brutall-fruit.png'),
    ('Ace 51 limão', '/produtos/ace-51-limao.png'),
    ('Cerveja caracu', '/produtos/cerveja-caracu.png'),
    ('Power ade bluy', '/produtos/power-ade-bluy.png'),
    ('Gatorade bluy', '/produtos/gatorade-bluy.png'),
    ('Gatorade moran, maracuja', '/produtos/gatorade-mora-maracuja.png'),
    ('Gatorade tangirina', '/produtos/gatorade-tangirina.png'),
    ('Gatorade laranja', '/produtos/gatorade-laranja.png'),
    ('Gatorade uva', '/produtos/gatorade-uva.png'),
    ('Gatorade limão', '/produtos/gatorade-limao.png'),
    ('Fanta uva lata 310ml', '/produtos/fanta-uva-lata-310ml.png'),
    ('Fanta carmesim 310ml', '/produtos/fanta-carmesim-310ml.png'),
    ('Coca zero lata 310 ml', '/produtos/coca-zero-lata-310ml.png'),
    ('Pepsi zero lata 350ml', '/produtos/pepsi-zero-lata-350ml.png'),
    ('Guaraná zero 350 ml', '/produtos/guarana-zero-350ml.png'),
    ('Ks zero 290ml', '/produtos/ks-zero-290ml.png'),
    ('Coca zero 1 litro retornável', '/produtos/coca-zero-1-litro-retornavel.png'),
    ('Coca LS 1 litro', '/produtos/coca-ls-1-litro.png'),
    ('Kapo uva', '/produtos/kapo-uva.png'),
    ('Kapo laranja', '/produtos/kapo-laranja.png'),
    ('Kapo morango', '/produtos/kapo-morango.png')
  ;

  update public.cervejas c
     set foto = f.foto
    from _foto f
   where c.distribuidora_id = d_id
     and lower(regexp_replace(c.nome, '\s+', ' ', 'g')) =
         lower(regexp_replace(f.nome, '\s+', ' ', 'g'))
     and c.foto is distinct from f.foto;
  get diagnostics n = row_count;

  for r in
    select f.nome from _foto f
     where not exists (
       select 1 from public.cervejas c
        where c.distribuidora_id = d_id
          and lower(regexp_replace(c.nome, '\s+', ' ', 'g')) =
              lower(regexp_replace(f.nome, '\s+', ' ', 'g'))
     )
  loop
    raise notice 'ATENCAO: nao achei o produto "%" — foto nao aplicada.', r.nome;
  end loop;

  raise notice 'Bola 7: % produto(s) ganharam foto.', n;
end $$;

-- ============================================================================
--  CONFERÊNCIA — quem AINDA está sem foto (o esperado agora é NENHUM produto:
--  a Fanta carmesim, que faltava, chegou depois e entrou na lista acima)
-- ============================================================================
select coalesce(categoria, '—') as pasta, nome
  from public.cervejas
 where distribuidora_id = (select id from public.distribuidoras
                            where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) = 'bola7')
   and ativo = true
   and (foto is null or foto = '')
 order by 1, 2;
