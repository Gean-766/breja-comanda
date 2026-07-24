-- ============================================================================
--  Módulos opcionais por distribuidora
-- ----------------------------------------------------------------------------
--  O NÚCLEO — Comandas, Produtos, Histórico — todo cliente já tem.
--  Esta coluna guarda só os EXTRAS que o cliente contratou. Cada item liga uma
--  aba a mais no app dele:  'estoque' | 'relatorio' | 'cozinha'.
--
--  Vazio ('{}') = só o núcleo. Por isso é seguro rodar: as distribuidoras que
--  já existem (BREJA & CIA) continuam exatamente como estão, com as 3 abas.
--
--  Quem liga/desliga é o painel CEO (service_role). A distribuidora NÃO
--  consegue mexer nisso — não existe policy de UPDATE pra ela em distribuidoras.
-- ============================================================================

alter table public.distribuidoras
  add column if not exists modulos text[] not null default '{}';
