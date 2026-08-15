-- ============================================================================
--  TURNO DE CAIXA (abrir / fechar o dia)
--  Roda no Supabase → SQL Editor → New query → cola → Run.
--  É ADITIVO e seguro: cria uma tabela nova e uma coluna nova.
--  NÃO apaga, NÃO altera e NÃO move nenhuma venda que já está no banco.
--
--  O PROBLEMA QUE ISTO RESOLVE
--  --------------------------
--  Bar não fecha à meia-noite. O relatório fechava: quem estava bebendo às
--  01:30 do dia 15 já caía num relatório novo, e a noite do dia 14 aparecia
--  cortada pela metade.
--
--  COMO PASSA A FUNCIONAR
--  ----------------------
--  O "dia" deixa de ser o do calendário e passa a ser o TURNO:
--    1) o dono abre o caixa quando começa a noite e fecha quando o último sai;
--       tudo que acontece entre os dois pertence ao dia da ABERTURA;
--    2) se ele esquecer de fechar, entra a HORA DA VIRADA (05:00 por padrão):
--       o dia se fecha sozinho ali e o seguinte começa — assim ele nunca
--       acumula duas noites num relatório só.
--
--  As vendas continuam gravadas exatamente como estão (com o horário real).
--  O que muda é só a JANELA que o relatório lê. Por isso as noites antigas
--  também se ajeitam sozinhas: a madrugada do dia 15 volta pro dia 14 sem
--  ninguém tocar em uma linha de venda.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Hora da virada da loja (quando o dia de ontem finalmente acaba).
--    5 = 05:00 da manhã. Bar que varre até mais tarde é só aumentar aqui:
--        update distribuidoras set hora_virada = 6 where nome = 'BREJA & CIA';
-- ---------------------------------------------------------------------------
alter table public.distribuidoras
  add column if not exists hora_virada int not null default 5;

-- ---------------------------------------------------------------------------
-- 2) Os turnos de caixa
--    `dia` é o dia do BAR (o dia da abertura), não o do calendário: um caixa
--    aberto 14/08 às 19h e fechado 15/08 às 03h tem dia = 2026-08-14.
-- ---------------------------------------------------------------------------
create table if not exists public.caixas (
  id               uuid primary key default gen_random_uuid(),
  distribuidora_id uuid references public.distribuidoras(id) on delete cascade,
  dia              date not null,                        -- a que noite este turno pertence
  aberto_em        timestamptz not null default now(),
  fechado_em       timestamptz,                          -- null = ainda aberto
  fundo_troco      numeric(10,2) not null default 150,   -- troco que começou na gaveta
  contado          numeric(10,2),                        -- quanto ele contou na gaveta no fim (opcional)
  obs              text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_caixas_dist on public.caixas(distribuidora_id, dia desc);
create index if not exists idx_caixas_dia  on public.caixas(dia desc);

-- Trava: uma distribuidora só pode ter UM caixa aberto por vez. Se dois
-- celulares tocarem "abrir caixa" ao mesmo tempo, o segundo é recusado pelo
-- banco (o app trata isso e simplesmente usa o caixa que já abriu).
create unique index if not exists uq_caixa_aberto
  on public.caixas(distribuidora_id)
  where fechado_em is null;

-- ---------------------------------------------------------------------------
-- 3) Carimbo automático do dono (mesmo trigger das outras tabelas)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_dist_caixas on public.caixas;
create trigger trg_dist_caixas
  before insert on public.caixas
  for each row execute function fn_set_distribuidora();

-- ---------------------------------------------------------------------------
-- 4) RLS: cada distribuidora só mexe no que é dela (mesma regra dos outros)
-- ---------------------------------------------------------------------------
alter table public.caixas enable row level security;

drop policy if exists "tenant_caixas" on public.caixas;
create policy "tenant_caixas" on public.caixas for all to authenticated
  using      (distribuidora_id = fn_minha_distribuidora())
  with check  (distribuidora_id = fn_minha_distribuidora());

-- ---------------------------------------------------------------------------
-- 5) Tempo real (aditivo — não recria a publicação).
--    Protegido: se a tabela já estiver na publicação (re-run), ignora sem erro.
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table caixas;
exception
  when duplicate_object then null; -- já estava na publicação, tudo certo
end $$;

-- ####  FIM  ####
-- Confere:
--   select tablename, policyname from pg_policies where tablename = 'caixas';
--   select dia, aberto_em, fechado_em, fundo_troco from caixas order by aberto_em desc;
