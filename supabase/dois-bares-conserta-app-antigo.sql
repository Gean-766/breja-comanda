-- ============================================================================
--  O APP ANTIGO VOLTA A VENDER, MESMO COM O LOGIN ALCANCANDO DOIS BARES
--  Roda no Supabase, SQL Editor. Aditivo, uma funcao so, seguro com o bar
--  cheio. Vale na hora, sem publicar nada, sem mexer em celular nenhum.
--
--  ------------------------------------------------------------------------
--  O QUE ACONTECEU (31/08/2026, no Bola 7)
--  ------------------------------------------------------------------------
--  O Adenilton foi abrir o caixa e recebeu "Nao consegui abrir o caixa. Sem
--  conexao?", com a internet funcionando.
--
--  Nao era conexao, nem banco. Era o CELULAR dele, que guarda o aplicativo
--  por dentro e so troca pela versao nova na segunda vez que abre. Ele estava
--  rodando o aplicativo do dia anterior, e o do dia anterior nao sabe dizer em
--  qual bar gravar - coisa que virou obrigatoria no instante em que o login
--  bola7 ganhou o segundo bar.
--
--  O banco entao recusou, de proposito, em vez de chutar. A trava funcionou
--  como projetada. O problema e que ela e cega demais.
--
--  ------------------------------------------------------------------------
--  POR QUE ESTA CORRECAO NAO E UM CHUTE
--  ------------------------------------------------------------------------
--  Todo login nasce dono de UM bar. Isso fica gravado em
--  distribuidoras.auth_user_id, e e de la que o aplicativo ANTIGO tira o bar
--  que ele mostra na tela: ele procura a loja daquele login e pronto. Ele nao
--  tem seletor, nao sabe trocar de andar, nao consegue estar olhando outro bar.
--
--  Entao, quando o pedido chega sem dizer o bar, existe UMA resposta certa e
--  ela e conhecida: o bar nativo daquele login. Nao e escolher um entre dois.
--  E devolver a unica coisa que o aplicativo antigo poderia estar querendo.
--
--  O aplicativo NOVO nunca passa por aqui: ele manda o bar em toda gravacao,
--  nas 21 delas. Esta linha so existe pros celulares atrasados.
--
--  E o erro continua existindo pra quem nao tem bar nativo, que e o caso do
--  login avulso do dono. Esse nem entra no aplicativo antigo, entao nao ha o
--  que salvar - e melhor recusar do que inventar.
-- ============================================================================

create or replace function public.fn_set_distribuidora()
returns trigger
language plpgsql
security definer
set search_path = public
as $SET$
declare
  ids    uuid[];
  nativo uuid;
begin
  -- O aplicativo ja disse de qual bar e. O with check da policy confere se ele
  -- podia mesmo gravar la, entao aqui e so respeitar.
  if new.distribuidora_id is not null then
    return new;
  end if;

  select array_agg(d) into ids from public.fn_minhas_distribuidoras() d;

  -- Sem acesso a bar nenhum: deixa passar em branco e o RLS recusa logo
  -- abaixo, com a mensagem dele. Erro de acesso e assunto do RLS.
  if ids is null or array_length(ids, 1) = 0 then
    return new;
  end if;

  -- Um bar so: nao ha duvida nenhuma.
  if array_length(ids, 1) = 1 then
    new.distribuidora_id := ids[1];
    return new;
  end if;

  -- Mais de um bar e o aplicativo nao disse qual. Isto e um celular com o
  -- aplicativo velho guardado dentro. O bar nativo deste login e o unico que
  -- aquele aplicativo consegue mostrar, entao e nele que a venda entra.
  select d.id
    into nativo
    from public.distribuidoras d
   where d.auth_user_id = auth.uid()
     and d.id = any (ids)
   limit 1;

  if nativo is not null then
    new.distribuidora_id := nativo;
    return new;
  end if;

  -- Sobrou o caso sem resposta certa: login avulso, sem bar nativo, com dois
  -- bares. Esse nao entra no aplicativo antigo, entao ninguem chega aqui por
  -- acidente. Continua recusando, porque inventar um bar aqui seria jogar
  -- dinheiro no relatorio errado, calado.
  raise exception 'Este login alcanca mais de um bar e o aplicativo nao disse em qual gravar. Feche o aplicativo e abra de novo duas vezes, pra ele pegar a versao nova.'
    using errcode = 'check_violation';
end;
$SET$;

-- ####  FIM  ####
--
-- DEU CERTO? No painel, devolva o segundo bar ao login do dono e peca pra ele
-- abrir o caixa. Tem que abrir na hora, mesmo no celular sem atualizar.
--
-- Confere quem tem bar nativo e quantos bares alcanca:
--   select coalesce(a.login, d.login) as login,
--          count(*) as bares,
--          bool_or(dn.auth_user_id is not null) as tem_bar_nativo
--     from public.acessos a
--     left join public.distribuidoras d  on d.auth_user_id = a.auth_user_id
--     left join public.distribuidoras dn on dn.id = a.distribuidora_id
--                                       and dn.auth_user_id = a.auth_user_id
--    group by 1
