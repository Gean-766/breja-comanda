-- ============================================================================
--  MÓDULO ESTOQUE
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--  É ADITIVO e seguro: cria colunas/tabela novas e não toca em dado nenhum.
--  Só faz efeito pra quem tiver o módulo 'estoque' ligado no painel.
--
--  Como o saldo funciona:
--    saldo = (contagem inicial + tudo que foi abastecido) − (o que saiu nas
--    comandas desde a contagem inicial). A "saída" já existe: são os consumos.
--    Por isso a gente só precisa registrar a ENTRADA de mercadoria.
-- ============================================================================

-- 1) Custo e alerta no produto ------------------------------------------------
--    custo_caixa   = quanto custa a caixa/fardo na compra (ex: 60.00)
--    unidades_caixa= quantas unidades vêm na caixa (ex: 12)  → custo unitário sai daí
--    estoque_min   = avisar quando o saldo chegar nesse número (0 = sem aviso)
alter table public.cervejas
  add column if not exists custo_caixa    numeric,
  add column if not exists unidades_caixa integer,
  add column if not exists estoque_min    integer;

-- 2) Entradas de mercadoria (abastecimento + contagem inicial) ----------------
create table if not exists public.estoque_entradas (
  id               uuid primary key default gen_random_uuid(),
  distribuidora_id uuid references public.distribuidoras(id) on delete cascade,
  cerveja_id       uuid not null references public.cervejas(id) on delete cascade,
  unidades         integer not null,      -- total de unidades que entraram
  caixas           numeric,               -- quantas caixas (quando informado por caixa)
  custo_caixa      numeric,               -- custo da caixa nessa compra (histórico)
  obs              text,                  -- ex: 'contagem inicial'
  created_at       timestamptz not null default now()
);
create index if not exists idx_estoque_entradas_cerveja on public.estoque_entradas(cerveja_id);
create index if not exists idx_estoque_entradas_dist    on public.estoque_entradas(distribuidora_id);

-- 3) Carimbo automático do dono (mesmo trigger das outras tabelas) ------------
drop trigger if exists trg_dist_estoque on public.estoque_entradas;
create trigger trg_dist_estoque
  before insert on public.estoque_entradas
  for each row execute function fn_set_distribuidora();

-- 4) RLS: cada distribuidora só mexe no que é dela (mesma regra dos outros) ---
alter table public.estoque_entradas enable row level security;

drop policy if exists "tenant_estoque_entradas" on public.estoque_entradas;
create policy "tenant_estoque_entradas" on public.estoque_entradas for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

-- 5) Tempo real (aditivo — não recria a publicação) --------------------------
alter publication supabase_realtime add table estoque_entradas;

-- ####  FIM  ####
-- Confere: select tablename, policyname from pg_policies where tablename = 'estoque_entradas';
