-- ============================================================================
--  FOTO DO PRODUTO PELO CELULAR (câmera ou galeria)
--  Roda no Supabase → SQL Editor → New query → cola → Run. Roda UMA vez, vale
--  pra todas as distribuidoras.
--
--  Pra quê: até agora foto de produto entrava pelo repositório (eu subia o
--  arquivo e escrevia um SQL). Com isto, o próprio lojista tira a foto da
--  mercadoria que chegou — ou escolhe da galeria — direto no Cadastrar.
--
--  Como funciona: a imagem vai pro Storage do Supabase, no balde `produtos`,
--  e o endereço público dela é gravado na coluna `cervejas.foto` — a mesma
--  coluna de sempre. As fotos antigas, que estão dentro do app
--  (/produtos/xxx.png), continuam funcionando: o app só lê o que está na
--  coluna, não importa de onde a imagem vem.
--
--  O app encolhe a foto pra ~50 KB antes de subir (600px, JPEG), então isso
--  não vira um problema de espaço nem de internet no bar.
-- ============================================================================

-- 1) O balde. `public = true` faz a imagem abrir por link direto, que é o que
--    o <img> do app precisa. Não tem nada sensível numa foto de cerveja.
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do update set public = true;

-- 2) Quem pode o quê.
--    Ler: qualquer um (é o link público da imagem).
--    Subir: só quem está logado — ou seja, uma distribuidora com acesso ativo.
alter table storage.objects enable row level security;

drop policy if exists "produtos_foto_leitura" on storage.objects;
create policy "produtos_foto_leitura" on storage.objects
  for select
  using (bucket_id = 'produtos');

drop policy if exists "produtos_foto_envio" on storage.objects;
create policy "produtos_foto_envio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'produtos');

-- Trocar a foto de um produto sobe um arquivo NOVO (o caminho leva a hora),
-- então não precisa de permissão de update nem de delete. O arquivo antigo
-- fica lá, ocupando alguns KB — de propósito: é o que permite voltar atrás se
-- alguém trocar a foto por engano.

-- ####  FIM  ####
-- Confere:
--   select id, public from storage.buckets where id = 'produtos';
--   select policyname from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'produtos_foto%';
