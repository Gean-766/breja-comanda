-- ============================================================================
--  BOTAO DE PANICO — devolve cada login a UM bar so
--  Roda no Supabase, SQL Editor. Cola, roda, acabou.
--
--  ------------------------------------------------------------------------
--  QUANDO USAR ISTO
--  ------------------------------------------------------------------------
--  Se um login alcanca DOIS bares enquanto o aplicativo em producao ainda e o
--  antigo, a venda para de entrar. Nao e defeito, e a trava funcionando: o
--  aplicativo antigo nao diz em qual bar gravar, e o banco se recusa a chutar,
--  porque chutar aqui significa lancar a venda de um bar no relatorio do
--  outro, calado, e so aparecer no fim do mes.
--
--  O sintoma no bar e esse: o garcom lanca e da erro, com uma mensagem
--  falando em atualizar o aplicativo.
--
--  Este arquivo desfaz. Depois dele, cada login volta a alcancar so o bar
--  dele, e o aplicativo de producao volta a vender na hora. Nao precisa
--  publicar nada, nao precisa reiniciar nada.
--
--  ------------------------------------------------------------------------
--  O QUE ELE APAGA, EXATAMENTE
--  ------------------------------------------------------------------------
--  So as linhas de acesso EXTRAS: as que foram dadas a mao pelo painel.
--  A linha original de cada bar, aquela que nasceu junto com o login dele,
--  fica. Ou seja: ninguem perde o acesso ao proprio bar.
--
--  Nao encosta em venda, comanda, estoque, produto ou caixa. Nada disso.
--
--  ATENCAO: se voce ja tinha criado o login avulso do dono, ele some daqui
--  tambem, porque ele e um acesso extra por definicao. E so criar de novo
--  depois, no painel, quando o aplicativo novo estiver em producao.
-- ============================================================================

-- Antes: quem alcanca mais de um bar hoje
select coalesce(a.login, d.login) as login, count(*) as bares
  from public.acessos a
  left join public.distribuidoras d on d.auth_user_id = a.auth_user_id
 group by 1
having count(*) > 1;


-- O desfazer
delete from public.acessos a
 where not exists (
        select 1
          from public.distribuidoras d
         where d.id = a.distribuidora_id
           and d.auth_user_id = a.auth_user_id
      );


-- Depois: tem que vir VAZIO
select coalesce(a.login, d.login) as login, count(*) as bares
  from public.acessos a
  left join public.distribuidoras d on d.auth_user_id = a.auth_user_id
 group by 1
having count(*) > 1;

-- ####  FIM  ####
-- Veio vazio na ultima consulta? O bar volta a vender na hora.
