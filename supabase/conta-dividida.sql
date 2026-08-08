-- ============================================================================
--  CONTA DIVIDIDA / PAGAMENTO PARCIAL
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--  É ADITIVO e seguro: cria só uma tabela nova, não toca em nada existente.
--
--  Pra quê: na mesa, um amigo sai mais cedo e paga só uma parte (ex: 2 cervejas
--  ou R$ 40). A gente guarda cada pagamento parcial aqui. A mesa continua aberta
--  mostrando "Falta pagar R$ X" até quitar tudo. Os consumos NÃO são mexidos —
--  o estoque e o relatório continuam certinhos; isto aqui é só o "quanto já pagou".
-- ============================================================================

create table if not exists public.pagamentos_parciais (
  id               uuid primary key default gen_random_uuid(),
  distribuidora_id uuid references public.distribuidoras(id) on delete cascade,
  cliente_id       uuid not null references public.clientes(id) on delete cascade,
  valor            numeric(10,2) not null default 0,  -- quanto esse amigo pagou
  qtd              integer,                            -- qtas garrafas (quando paga por garrafa; informativo)
  obs              text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_parciais_cliente on public.pagamentos_parciais(cliente_id);
create index if not exists idx_parciais_dist    on public.pagamentos_parciais(distribuidora_id);

-- Carimbo automático do dono (mesmo trigger das outras tabelas)
drop trigger if exists trg_dist_parciais on public.pagamentos_parciais;
create trigger trg_dist_parciais
  before insert on public.pagamentos_parciais
  for each row execute function fn_set_distribuidora();

-- RLS: cada distribuidora só mexe no que é dela (mesma regra dos outros)
alter table public.pagamentos_parciais enable row level security;

drop policy if exists "tenant_parciais" on public.pagamentos_parciais;
create policy "tenant_parciais" on public.pagamentos_parciais for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check (distribuidora_id = fn_minha_distribuidora());

-- Tempo real (aditivo — não recria a publicação)
alter publication supabase_realtime add table pagamentos_parciais;

-- ####  FIM  ####
-- Confere: select tablename, policyname from pg_policies where tablename = 'pagamentos_parciais';
