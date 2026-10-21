-- ============================================================================
--  SNOOKER BAR → tira o emoji que o dono digitou no NOME da pasta
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--
--  "🍶AGUA" e "🎱FICHA SINUCA" ficavam "🏷️ 🍶AGUA" na tela: a figurinha da
--  pasta quem põe é o app (iconePasta, pelo nome). Sem o emoji no nome, o app
--  mostra 💧 AGUA e 🎱 FICHA SINUCA.
--
--  Mexe só na coluna `categoria` (a pasta). NÃO apaga, NÃO renomeia produto,
--  NÃO mexe em preço nem em estoque. Idempotente. Só o Snooker.
-- ============================================================================

do $$
declare
  d_id uuid;
  n    int;
begin
  select id into d_id
    from public.distribuidoras
   where lower(regexp_replace(nome, '[^a-zA-Z0-9]', '', 'g')) like '%snook%'
   limit 1;

  if d_id is null then
    raise exception 'Distribuidora "Snooker" nao encontrada.';
  end if;

  update public.cervejas
     set categoria = trim(regexp_replace(categoria, '^[^[:alnum:]]+', ''))
   where distribuidora_id = d_id
     and categoria ~ '^[^[:alnum:]]';
  get diagnostics n = row_count;

  raise notice 'Snooker: % produto(s) tiveram o nome da pasta limpo.', n;
end $$;

-- CONFERÊNCIA — as pastas como ficaram
select coalesce(nullif(trim(c.categoria), ''), '(sem pasta)') as pasta,
       count(*) as produtos
  from public.cervejas c
  join public.distribuidoras d on d.id = c.distribuidora_id
 where lower(regexp_replace(d.nome, '[^a-zA-Z0-9]', '', 'g')) like '%snook%'
   and c.ativo = true
 group by 1
 order by 1;
