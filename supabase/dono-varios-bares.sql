-- ============================================================================
--  UM DONO, VARIOS BARES
--  Roda no Supabase, SQL Editor. E ADITIVO: cria uma tabela nova e troca as
--  regras de leitura por versoes que aceitam mais de um bar.
--
--  Pode rodar com o bar vendendo. Nada e apagado, nada e movido.
--
--  ------------------------------------------------------------------------
--  O PROBLEMA
--  ------------------------------------------------------------------------
--  O Bola 7 e um predio de dois andares. Embaixo o bar, em cima as mesas de
--  sinuca. Sao dois bares de verdade, com estoque, caixa e comanda separados,
--  mas um dono so. Ele precisa ver os dois sem sair e entrar de novo.
--
--  Hoje isso e impossivel, e nao por causa da tela: e regra do banco.
--    distribuidoras.auth_user_id e UNIQUE
--    fn_minha_distribuidora() termina em LIMIT 1
--  Um login alcanca um bar, e ponto.
--
--  ------------------------------------------------------------------------
--  O QUE MUDA
--  ------------------------------------------------------------------------
--  Nasce a tabela `acessos`, que e so uma lista de quem entra onde:
--
--     login       bar        papel
--     bola7       Terreo     funcionario
--     bola7cima   Sinuca     funcionario
--     adenilton   Terreo     dono
--     adenilton   Sinuca     dono
--
--  O dono aparece duas vezes. E esse o truque inteiro.
--
--  ------------------------------------------------------------------------
--  POR QUE ISTO NAO QUEBRA NENHUM CLIENTE DE HOJE
--  ------------------------------------------------------------------------
--  Todo login que existe hoje alcanca UM bar. Pra quem alcanca um so, as
--  regras novas dao exatamente o mesmo resultado das antigas. A Breja e Cia,
--  a Bola 7 e as contas de teste continuam funcionando sem uma linha de
--  aplicativo mudar.
--
--  A parte perigosa e o CARIMBO. Nenhum insert do aplicativo manda
--  distribuidora_id: quem preenche e o trigger, chamando uma funcao que
--  terminava em LIMIT 1. Com dois bares no mesmo login, esse LIMIT 1 vira
--  cara ou coroa, e a venda de cima podia ser carimbada como de baixo, em
--  silencio, so aparecendo no relatorio do mes. Por isso, aqui, o trigger
--  passa a DAR ERRO em vez de chutar. Ver o item 5.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) A lista de quem entra onde
-- ---------------------------------------------------------------------------
create table if not exists public.acessos (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid not null,
  distribuidora_id uuid not null references public.distribuidoras(id) on delete cascade,
  papel            text not null default 'funcionario',
  created_at       timestamptz not null default now(),
  unique (auth_user_id, distribuidora_id)
);

do $$
begin
  alter table public.acessos
    add constraint acessos_papel_valido check (papel in ('dono', 'funcionario'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_acessos_user on public.acessos(auth_user_id);
create index if not exists idx_acessos_dist on public.acessos(distribuidora_id);


-- ---------------------------------------------------------------------------
-- 2) Migracao: todo login que ja existe entra na lista como DONO
--
--    Dono, e nao funcionario, de proposito. Hoje quem entra com o login da
--    loja ve todas as abas que a loja contratou. Se a migracao os marcasse
--    como funcionario, o bar inteiro perderia Estoque e Relatorio na manha
--    seguinte sem ninguem ter pedido. Rebaixar e escolha do Gean, loja por
--    loja, com o comando que esta no fim deste arquivo.
-- ---------------------------------------------------------------------------
insert into public.acessos (auth_user_id, distribuidora_id, papel)
select d.auth_user_id, d.id, 'dono'
  from public.distribuidoras d
 where d.auth_user_id is not null
on conflict (auth_user_id, distribuidora_id) do nothing;


-- ---------------------------------------------------------------------------
-- 3) O painel CEO continua funcionando SEM MUDANCA NENHUMA
--
--    Quando o painel cria um acesso, ele grava distribuidoras.auth_user_id
--    direto, via service_role. Este trigger escuta isso e espelha na lista
--    nova. Assim o painel antigo e o modelo novo nao brigam, e um cliente
--    criado amanha ja nasce certo.
-- ---------------------------------------------------------------------------
create or replace function public.fn_espelha_acesso()
returns trigger
language plpgsql
security definer
set search_path = public
as $ESP$
begin
  -- tirou o acesso (o painel desfaz o vinculo antes de apagar o usuario):
  -- some com a linha espelhada, e so com ela
  if tg_op = 'UPDATE' and old.auth_user_id is not null
     and (new.auth_user_id is null or new.auth_user_id <> old.auth_user_id) then
    delete from public.acessos
     where distribuidora_id = old.id
       and auth_user_id = old.auth_user_id;
  end if;

  if new.auth_user_id is not null then
    insert into public.acessos (auth_user_id, distribuidora_id, papel)
    values (new.auth_user_id, new.id, 'dono')
    on conflict (auth_user_id, distribuidora_id) do nothing;
  end if;

  return new;
end;
$ESP$;

drop trigger if exists trg_espelha_acesso on public.distribuidoras;
create trigger trg_espelha_acesso
  after insert or update of auth_user_id on public.distribuidoras
  for each row execute function public.fn_espelha_acesso();


-- ---------------------------------------------------------------------------
-- 4) Quem sou eu agora: uma LISTA, nao um bar so
--
--    Sobre o status: a versao antiga exigia status = ativa. Mas o Portao.jsx
--    deixa entrar tambem quem esta em teste. O resultado era uma loja de
--    teste que passava da porta e caia num aplicativo VAZIO, com todo
--    lancamento recusado e nenhuma explicacao na tela. Corrigido aqui: teste
--    entra na lista igual a ativa.
-- ---------------------------------------------------------------------------
create or replace function public.fn_minhas_distribuidoras()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $MD$
  select a.distribuidora_id
    from public.acessos a
    join public.distribuidoras d on d.id = a.distribuidora_id
   where a.auth_user_id = auth.uid()
     and d.status in ('ativa', 'teste')
     and (d.vence_em is null or d.vence_em >= current_date)
$MD$;

revoke all on function public.fn_minhas_distribuidoras() from public;
grant execute on function public.fn_minhas_distribuidoras() to authenticated;

-- A mesma lista, mas SEM filtro de status ou vencimento. E de proposito, e e
-- ela que sustenta a tela de acesso expirado: sem isto o aplicativo mostraria
-- uma tela vazia sem explicar por que.
create or replace function public.fn_minhas_lojas_todas()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $MLT$
  select a.distribuidora_id from public.acessos a where a.auth_user_id = auth.uid()
$MLT$;

revoke all on function public.fn_minhas_lojas_todas() from public;
grant execute on function public.fn_minhas_lojas_todas() to authenticated;

-- Continua existindo, porque o resto do banco chama por este nome. Agora ela
-- so responde quando NAO ha duvida: um bar so. Com dois, devolve nulo de
-- proposito, pra ninguem tomar decisao no chute.
create or replace function public.fn_minha_distribuidora()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $MID$
declare
  ids uuid[];
begin
  select array_agg(d) into ids from public.fn_minhas_distribuidoras() d;
  if ids is null or array_length(ids, 1) <> 1 then
    return null;
  end if;
  return ids[1];
end;
$MID$;

revoke all on function public.fn_minha_distribuidora() from public;
grant execute on function public.fn_minha_distribuidora() to authenticated;


-- ---------------------------------------------------------------------------
-- 5) O CARIMBO - a parte que mais importa deste arquivo
--
--    Antes: se o insert vinha sem dono, a funcao carimbava com o unico bar
--    do login. Com dois bares, ela carimbaria com um deles ao acaso e a
--    venda de cima entraria no relatorio de baixo sem erro nenhum na tela.
--
--    Agora: manda parar. Erro na tela do garcom e chato; venda no bar errado
--    e dinheiro perdido que ninguem acha depois. Entre os dois, o erro.
--
--    Quem alcanca um bar so continua igualzinho: nem percebe que mudou.
-- ---------------------------------------------------------------------------
create or replace function public.fn_set_distribuidora()
returns trigger
language plpgsql
security definer
set search_path = public
as $SET$
declare
  ids uuid[];
begin
  -- o aplicativo ja disse de qual bar e. O with check da policy confere se
  -- ele podia mesmo gravar la, entao aqui e so respeitar.
  if new.distribuidora_id is not null then
    return new;
  end if;

  select array_agg(d) into ids from public.fn_minhas_distribuidoras() d;

  -- sem acesso a bar nenhum: deixa passar em branco e o RLS recusa logo
  -- abaixo, com a mensagem dele. Erro de acesso e assunto do RLS.
  if ids is null or array_length(ids, 1) = 0 then
    return new;
  end if;

  if array_length(ids, 1) > 1 then
    raise exception 'Este login alcanca mais de um bar e o aplicativo nao disse em qual gravar. Atualize o aplicativo antes de continuar vendendo.'
      using errcode = 'check_violation';
  end if;

  new.distribuidora_id := ids[1];
  return new;
end;
$SET$;


-- ---------------------------------------------------------------------------
-- 6) As regras de leitura passam de UM bar pra uma LISTA de bares
--
--    Trocou o sinal de igual por IN. Pra quem alcanca um bar so, IN de uma
--    lista de um item da exatamente o mesmo resultado de antes.
-- ---------------------------------------------------------------------------
drop policy if exists "tenant_cervejas"          on public.cervejas;
drop policy if exists "tenant_clientes"          on public.clientes;
drop policy if exists "tenant_consumos"          on public.consumos;
drop policy if exists "tenant_historico"         on public.historico;
drop policy if exists "tenant_estoque_entradas"  on public.estoque_entradas;
drop policy if exists "tenant_caixas"            on public.caixas;
drop policy if exists "tenant_perdas"            on public.perdas;
drop policy if exists "tenant_parciais"          on public.pagamentos_parciais;

create policy "tenant_cervejas" on public.cervejas for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_clientes" on public.clientes for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_consumos" on public.consumos for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_historico" on public.historico for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_estoque_entradas" on public.estoque_entradas for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_caixas" on public.caixas for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_perdas" on public.perdas for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));

create policy "tenant_parciais" on public.pagamentos_parciais for all to authenticated
  using      (distribuidora_id in (select public.fn_minhas_distribuidoras()))
  with check (distribuidora_id in (select public.fn_minhas_distribuidoras()));


-- ---------------------------------------------------------------------------
-- 7) O aplicativo precisa enxergar a LISTA de bares que o login alcanca,
--    e o proprio acesso, pra saber se e dono ou funcionario.
--
--    Sem filtro de status aqui, igual antes: e assim que o aplicativo
--    consegue mostrar acesso expirado em vez de uma tela vazia.
-- ---------------------------------------------------------------------------
drop policy if exists "ver_minha_loja"   on public.distribuidoras;
drop policy if exists "ver_minhas_lojas" on public.distribuidoras;
create policy "ver_minhas_lojas" on public.distribuidoras for select to authenticated
  using (
    auth_user_id = auth.uid()
    or id in (select public.fn_minhas_lojas_todas())
  );

alter table public.acessos enable row level security;

-- So leitura, e so das proprias linhas. Nao existe policy de escrita de
-- proposito: quem da e tira acesso e o painel CEO, com service_role. Se o
-- proprio login pudesse escrever aqui, ele se daria acesso a qualquer bar.
drop policy if exists "vejo_meus_acessos" on public.acessos;
create policy "vejo_meus_acessos" on public.acessos for select to authenticated
  using (auth_user_id = auth.uid());


-- ####  FIM  ####
--
-- CONFERE SE FICOU CERTO (tem que devolver uma linha por login que existe):
--   select d.nome, d.login, a.papel
--     from acessos a join distribuidoras d on d.id = a.distribuidora_id
--    order by d.nome
--
-- DAR O SEGUNDO BAR PRO DONO (depois que o bar de cima existir):
--   insert into acessos (auth_user_id, distribuidora_id, papel)
--   select (select auth_user_id from distribuidoras where login = 'adenilton'),
--          (select id from distribuidoras where login = 'bola7cima'),
--          'dono'
--
-- REBAIXAR UM LOGIN PRA FUNCIONARIO (ele passa a ver so Comandas e Historico):
--   update acessos set papel = 'funcionario'
--    where auth_user_id = (select auth_user_id from distribuidoras where login = 'bola7')
