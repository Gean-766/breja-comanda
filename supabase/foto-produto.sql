-- ============================================================================
--  FOTO DO PRODUTO PELO CELULAR (câmera ou galeria)
--  Roda no Supabase → SQL Editor → New query → cola → Run. Uma vez só, vale
--  pra todas as distribuidoras.
--
--  Pra quê: o próprio lojista tira a foto da mercadoria que chegou — ou pega
--  da galeria — direto no Cadastrar. A imagem vai pro Storage e o endereço
--  dela cai na coluna `cervejas.foto`, a mesma de sempre. As fotos antigas,
--  que estão dentro do app (/produtos/xxx.png), continuam funcionando.
--
--  ⚠️ `storage.objects` é uma tabela do Supabase, não sua: comandos que exigem
--  ser DONO dela (como `alter table ... enable row level security`) falham com
--  "must be owner of table objects" — e, como o editor roda o script inteiro
--  numa transação, um erro desses desfaz até o que já tinha dado certo.
--  Por isso aqui: nada de ALTER (o RLS dela já vem ligado de fábrica) e a
--  criação da política vai dentro de um bloco que, se não tiver permissão,
--  avisa o que clicar no painel em vez de derrubar o resto.
-- ============================================================================

-- 1) O balde. `public = true` faz a imagem abrir por link direto, que é o que
--    o <img> do app precisa (não tem nada sensível numa foto de cerveja).
--    Balde público já é lido sem política nenhuma — falta só deixar SUBIR.
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do update set public = true;

-- 2) Quem está logado (uma distribuidora com acesso ativo) pode subir foto.
do $$
begin
  execute $p$drop policy if exists "produtos_foto_envio" on storage.objects$p$;
  execute $p$create policy "produtos_foto_envio" on storage.objects
             for insert to authenticated
             with check (bucket_id = 'produtos')$p$;
  raise notice 'OK: balde criado e envio liberado. Pode testar no app.';
exception
  when insufficient_privilege then
    raise notice 'BALDE CRIADO, mas a politica precisa ser feita no painel:';
    raise notice '  Storage > Policies > objects > New policy > For full customization';
    raise notice '  Nome: produtos_foto_envio | Operacao: INSERT | Role: authenticated';
    raise notice '  WITH CHECK:  bucket_id = ''produtos''';
end $$;

-- Trocar a foto sobe um arquivo NOVO (o caminho leva a hora), então não é
-- preciso permissão de update nem de delete. O arquivo antigo fica lá,
-- ocupando alguns KB — de propósito: é o que permite voltar atrás se alguém
-- trocar a foto por engano.

-- ####  FIM  ####
-- Confere (tem que voltar uma linha, com public = true):
--   select id, public from storage.buckets where id = 'produtos';
-- E a política (se o painel foi usado, o nome pode ser outro):
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' and tablename = 'objects';
