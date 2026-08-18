-- ============================================================================
--  CAIXA → devolve cada noite pro dia certo (o desvio de +1 dia)
--  Roda no Supabase → SQL Editor → New query → cola tudo → Run.
--
--  NÃO APAGA NADA. Não encosta em venda, em comanda, em estoque, em perda nem
--  em relatório. A única coisa que muda é o RÓTULO da coluna `caixas.dia` — a
--  etiqueta que diz "este turno é da noite de tal dia". E antes de mudar,
--  guarda o valor antigo de todos numa tabela de backup (dá pra voltar).
--
--  O QUE ACONTECEU
--  ---------------
--  O app carimbava a noite olhando se "o caixa desta noite já foi fechado".
--  Só que ele olhava pelo RÓTULO — e um caixa rotulado 18/08 que fechou às
--  01:13 é a noite do dia 17 acabando de madrugada, não a noite do 18 que já
--  terminou. Bastou acontecer uma vez (fechar 01:13 e reabrir 02:00 pra lançar
--  uma venda esquecida) pro carimbo pular um dia. E dali em diante o erro se
--  copiava sozinho, noite após noite: cada turno nascia um dia à frente.
--
--  O ESTRAGO NA TELA
--   • o Relatório mostrava o faturamento de ONTEM no dia de HOJE;
--   • numa manhã de 18/08 o app oferecia "▶ Abrir o caixa de 19/08".
--
--  O QUE ESTE SCRIPT FAZ
--  ---------------------
--  Recalcula `dia` a partir do que não mente: a HORA REAL DE ABERTURA
--  (`aberto_em`), gravada certinha em todas as linhas. A regra é a mesma do
--  app: o turno pertence ao dia em que foi ABERTO, com a hora da virada
--  (05:00) segurando a madrugada na noite anterior. Caixa aberto 17/08 às
--  17:55 e fechado 18/08 às 01:13 → dia = 17/08.
--
--  Repare que ele NÃO "subtrai um dia" no chute: cada linha é recalculada do
--  zero. Linha que já estava certa fica como está, e rodar de novo não faz
--  nada na segunda vez.
--
--  IMPORTANTE: o conserto do banco anda junto com o conserto do app
--  (src/App.jsx, função `diaAtualDoBar`). Sem os dois, o desvio volta.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) FUSO DO BAR — America/Cuiaba (UTC-4).
--
--    Descoberto conferindo a tabela deste script contra a tela do app: o SQL
--    imprimiu "17/08 18:55, fechado 02:13" e o app mostrava "17:55, fechado
--    01:13". Uma hora exata de diferença nas duas pontas — o relógio do
--    celular roda em UTC-4, não em UTC-3. Qualquer fuso brasileiro de UTC-4
--    serve igual (Cuiaba, Manaus, Porto_Velho): nenhum tem horário de verão.
--    Bar em MG/SP/RJ/Sul/Nordeste: troque nos DOIS lugares marcados "FUSO"
--    por America/Sao_Paulo.
--
--    O FUSO NÃO MUDA O RÓTULO DAS NOITES, só os horários que a conferência
--    imprime. O carimbo do dia é a abertura menos 5h, e o bar abre de tarde:
--    uma hora pra lá ou pra cá só viraria a data de um caixa aberto entre 04h
--    e 06h. A checagem lá embaixo avisa se existir algum nessa faixa.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) BACKUP — guarda o rótulo atual de TODOS os caixas antes de mexer.
--    O "on conflict do nothing" é o que garante que, numa segunda rodada, o
--    valor ORIGINAL continue guardado em vez de ser sobrescrito pelo corrigido.
-- ---------------------------------------------------------------------------
create table if not exists public.caixas_dia_backup (
  caixa_id   uuid primary key references public.caixas(id) on delete cascade,
  dia_antigo date not null,
  salvo_em   timestamptz not null default now()
);

-- Fecha a tabela pro lado de fora: RLS ligada e nenhuma policy = ninguém entra
-- por ela pela API. Só o SQL Editor enxerga; o app nem sabe que ela existe.
alter table public.caixas_dia_backup enable row level security;

insert into public.caixas_dia_backup (caixa_id, dia_antigo)
select id, dia from public.caixas
on conflict (caixa_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) O CONSERTO — recalcula `dia` pela hora real de abertura
-- ---------------------------------------------------------------------------
do $$
declare
  fuso     text := 'America/Cuiaba';   -- FUSO (1 de 2) — veja o item 0
  n_certo  int;
  n_mexeu  int;
  n_risco  int;
  r        record;
begin
  -- Caixas abertos na faixa em que o fuso poderia virar a data (04h–06h).
  -- Deu zero: a escolha do fuso é indiferente pro resultado.
  select count(*) into n_risco
    from public.caixas cx
    left join public.distribuidoras d on d.id = cx.distribuidora_id
   where extract(hour from (cx.aberto_em at time zone fuso))
         between coalesce(d.hora_virada, 5) - 1 and coalesce(d.hora_virada, 5);

  -- Quantos já estavam com o rótulo certo (só pra informar no fim).
  select count(*) into n_certo
    from public.caixas cx
    left join public.distribuidoras d on d.id = cx.distribuidora_id
   where cx.dia = ((cx.aberto_em at time zone fuso)
                    - make_interval(hours => coalesce(d.hora_virada, 5)))::date;

  -- Lista, linha por linha, o que vai mudar (sai na aba "Messages").
  for r in
    select cx.dia as de,
           ((cx.aberto_em at time zone fuso)
             - make_interval(hours => coalesce(d.hora_virada, 5)))::date as para,
           to_char(cx.aberto_em at time zone fuso, 'DD/MM HH24:MI') as abriu,
           coalesce(to_char(cx.fechado_em at time zone fuso, 'DD/MM HH24:MI'),
                    'ainda aberto') as fechou
      from public.caixas cx
      left join public.distribuidoras d on d.id = cx.distribuidora_id
     where cx.dia is distinct from ((cx.aberto_em at time zone fuso)
                                     - make_interval(hours => coalesce(d.hora_virada, 5)))::date
     order by cx.aberto_em
  loop
    raise notice '  noite % -> %   (abriu %, fechou %)', r.de, r.para, r.abriu, r.fechou;
  end loop;

  update public.caixas c
     set dia = x.dia_certo
    from (
      select cx.id,
             ((cx.aberto_em at time zone fuso)
               - make_interval(hours => coalesce(d.hora_virada, 5)))::date as dia_certo
        from public.caixas cx
        left join public.distribuidoras d on d.id = cx.distribuidora_id
    ) x
   where x.id = c.id
     and c.dia is distinct from x.dia_certo;

  get diagnostics n_mexeu = row_count;

  raise notice '----------------------------------------------------------';
  raise notice 'Fuso usado: %', fuso;
  raise notice 'Caixas com a noite corrigida: %', n_mexeu;
  raise notice 'Caixas que ja estavam certos: %', n_certo;
  if n_risco > 0 then
    raise notice 'ATENCAO: % caixa(s) abertos perto da hora da virada.', n_risco;
    raise notice '  Confira esses na lista antes de dar por encerrado.';
  end if;
  raise notice 'Backup do rotulo antigo: public.caixas_dia_backup';
  raise notice '----------------------------------------------------------';
end $$;

-- ---------------------------------------------------------------------------
-- 3) CONFERÊNCIA — o resultado, noite por noite, com o antes e o depois
-- ---------------------------------------------------------------------------
select
  to_char(cx.dia, 'DD/MM/YYYY')       as noite_agora,
  to_char(b.dia_antigo, 'DD/MM/YYYY') as noite_antes,
  case when cx.dia = b.dia_antigo then '' else 'corrigido' end as mudou,
  -- FUSO (2 de 2) — se trocou lá em cima, troque nas duas linhas abaixo
  to_char(cx.aberto_em  at time zone 'America/Cuiaba', 'DD/MM HH24:MI') as abriu,
  coalesce(to_char(cx.fechado_em at time zone 'America/Cuiaba', 'DD/MM HH24:MI'),
           'ainda aberto') as fechou,
  cx.fundo_troco as troco,
  cx.contado
from public.caixas cx
left join public.caixas_dia_backup b on b.caixa_id = cx.id
order by cx.aberto_em desc;

-- ####  FIM  ####
--
-- SE PRECISAR VOLTAR TUDO como estava (tira os dois tracinhos e roda):
--   update public.caixas c
--      set dia = b.dia_antigo
--     from public.caixas_dia_backup b
--    where b.caixa_id = c.id
--      and c.dia is distinct from b.dia_antigo;
