-- ============================================================================
--  MÓDULO PERDAS (quebra / vencimento / estrago)
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--  É ADITIVO e seguro: cria só uma tabela nova, não toca em nada existente.
--
--  Pra quê: abriu a cerveja e quebrou, venceu, estragou → registra aqui.
--  A perda SAI do estoque (o saldo cai igual a uma venda), aparece no
--  Relatório como "Perdas" (nunca como venda/faturamento) e fica guardada
--  na aba Perdas. NÃO mexe em consumos — venda continua sendo venda.
-- ============================================================================

create table if not exists public.perdas (
  id               uuid primary key default gen_random_uuid(),
  distribuidora_id uuid references public.distribuidoras(id) on delete cascade,
  cerveja_id       uuid references public.cervejas(id) on delete set null, -- pra descontar do saldo
  beer_nome        text not null,                       -- foto/nome fixo (relatório sobrevive se o produto sumir)
  preco_unit       numeric(10,2) not null default 0,    -- preço no momento (valoriza o prejuízo)
  quantidade       integer not null default 1,
  motivo           text,                                -- quebrou | venceu | estragou | cortesia...
  created_at       timestamptz not null default now()
);
create index if not exists idx_perdas_cerveja on public.perdas(cerveja_id);
create index if not exists idx_perdas_dist    on public.perdas(distribuidora_id);

-- Carimbo automático do dono (mesmo trigger das outras tabelas)
drop trigger if exists trg_dist_perdas on public.perdas;
create trigger trg_dist_perdas
  before insert on public.perdas
  for each row execute function fn_set_distribuidora();

-- RLS: cada distribuidora só mexe no que é dela (mesma regra dos outros)
alter table public.perdas enable row level security;

drop policy if exists "tenant_perdas" on public.perdas;
create policy "tenant_perdas" on public.perdas for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

-- Tempo real (aditivo — não recria a publicação)
alter publication supabase_realtime add table perdas;

-- ####  FIM  ####
-- Confere: select tablename, policyname from pg_policies where tablename = 'perdas';
