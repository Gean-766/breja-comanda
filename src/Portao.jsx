import { useCallback, useEffect, useState } from 'react'
import { supabase, isConfigured } from './supabase.js'
import Login from './Login.jsx'
import App from './App.jsx'

// Portão de entrada do app:
//   sem sessão            -> tela de login
//   sessão sem cadastro   -> aviso (acesso criado torto no painel)
//   bloqueada ou vencida  -> tela de acesso expirado
//   tudo certo            -> o app do bar
//
// ---------------------------------------------------------------------------
// UM LOGIN PODE ALCANÇAR MAIS DE UM BAR
// ---------------------------------------------------------------------------
// Nasceu do Bola 7: um prédio de dois andares, dois bares de verdade (estoque,
// caixa e comanda separados) e um dono só, que precisa ver os dois sem sair e
// entrar de novo.
//
// Quem alcança UM bar não vê diferença nenhuma — nem seletor, nem tela a mais.
// É o caso de todo cliente de hoje, e tem que continuar sendo.
//
// Quem alcança DOIS escolhe uma vez, e daí em diante troca pelo seletor lá no
// topo do app. A escolha fica guardada no aparelho: o celular do balcão abre
// sempre no mesmo andar.
const CHAVE_BAR = 'comanda.bar.escolhido'

function barGuardado() {
  try {
    return localStorage.getItem(CHAVE_BAR) || null
  } catch {
    return null
  }
}

function guardarBar(id) {
  try {
    if (id) localStorage.setItem(CHAVE_BAR, id)
    else localStorage.removeItem(CHAVE_BAR)
  } catch {
    /* sem localStorage o seletor continua funcionando, só não lembra depois */
  }
}

export default function Portao() {
  const [sessao, setSessao] = useState(undefined) // undefined = ainda checando
  const [lojas, setLojas] = useState(undefined) // undefined = ainda carregando
  const [papeis, setPapeis] = useState({}) // { [distribuidora_id]: 'dono' | 'funcionario' }
  const [escolhidoId, setEscolhidoId] = useState(barGuardado)
  // Pedido explícito de "quero escolher". Sem ele, o botão "Ver outro bar" da
  // tela de acesso expirado não teria efeito nenhum: ele limpa a escolha, e o
  // app cai de volta no bar de casa — que é exatamente o que está expirado.
  const [querEscolher, setQuerEscolher] = useState(false)

  // acompanha a sessão (fica salva no celular; não pede senha toda vez)
  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => setSessao(data?.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSessao(s || null)
      if (!s) setLojas(undefined)
    })
    return () => sub?.subscription?.unsubscribe()
  }, [])

  // com sessão, busca TODOS os bares que esse login alcança. O RLS já devolve
  // só os que são dele, então aqui não vai filtro nenhum.
  useEffect(() => {
    if (!sessao) return
    let vivo = true

    async function carregar() {
      const r = await supabase.from('distribuidoras').select('*').order('nome')
      if (!vivo) return
      setLojas(r.data || [])

      // Quem é dono e quem é funcionário em cada bar. Fica num select à parte
      // de propósito: enquanto o `dono-varios-bares.sql` não tiver rodado, a
      // tabela não existe, o erro morre aqui e todo mundo segue como dono —
      // que é exatamente o comportamento de hoje.
      const ra = await supabase.from('acessos').select('distribuidora_id, papel')
      if (!vivo) return
      if (!ra.error && ra.data) {
        const m = {}
        for (const a of ra.data) m[a.distribuidora_id] = a.papel
        setPapeis(m)
      }
    }

    carregar()
    return () => {
      vivo = false
    }
  }, [sessao])

  const trocarBar = useCallback((id) => {
    guardarBar(id)
    setEscolhidoId(id)
    setQuerEscolher(false)
  }, [])

  async function sair() {
    guardarBar(null)
    await supabase.auth.signOut()
  }

  if (!isConfigured) return <App />
  if (sessao === undefined) return <div className="centro">Carregando…</div>
  if (!sessao) return <Login />
  if (lojas === undefined) return <div className="centro">Entrando…</div>

  if (!lojas.length) {
    return (
      <Bloqueio
        emoji="⚠️"
        titulo="Acesso não configurado"
        texto="Esse login existe, mas não está ligado a nenhum bar. Fale com quem te vendeu o sistema."
        onSair={sair}
      />
    )
  }

  const escolhido = lojas.find((l) => l.id === escolhidoId)

  // O BAR DE CASA DESTE LOGIN.
  //
  // Todo login criado pelo painel nasce dono de um bar, e isso fica gravado em
  // `distribuidoras.auth_user_id`. Esse é o bar que o app SEMPRE abriu pra ele,
  // desde antes de existir segundo andar.
  //
  // Por isso ele é o padrão. Sem isto, o dia em que o celular do dono pegasse a
  // versão nova, ele abriria o app e daria de cara com uma tela "Qual bar?" que
  // nunca existiu — no meio do movimento, sem ninguém ter avisado. O seletor lá
  // em cima já dá conta de trocar de andar; não precisa de pedágio na entrada.
  //
  // (É a mesma regra que o banco usa quando um app desatualizado grava sem
  //  dizer o bar. Ver supabase/dois-bares-conserta-app-antigo.sql.)
  const daCasa = lojas.find((l) => l.auth_user_id && l.auth_user_id === sessao.user.id)

  // Só pergunta a quem NÃO tem bar de casa: é o login avulso do dono, que
  // nasceu alcançando dois andares e não tem um "de sempre" pra abrir.
  if (lojas.length > 1 && (querEscolher || (!escolhido && !daCasa))) {
    return <EscolhaBar lojas={lojas} onEscolher={trocarBar} onSair={sair} />
  }

  const loja = (querEscolher ? null : escolhido) || daCasa || lojas[0]

  const hoje = new Date().toISOString().slice(0, 10)
  const vencido = loja.vence_em && String(loja.vence_em).slice(0, 10) < hoje
  const inativa = loja.status !== 'ativa' && loja.status !== 'teste'

  if (vencido || inativa) {
    return (
      <Bloqueio
        emoji="🔒"
        titulo={vencido ? 'Acesso expirado' : 'Acesso bloqueado'}
        texto={
          vencido
            ? 'A validade do seu acesso terminou. Assim que a mensalidade for regularizada, ele volta na hora.'
            : 'Seu acesso está bloqueado no momento. Fale com quem te vendeu o sistema.'
        }
        rodape={loja.nome}
        // Um bar bloqueado não pode trancar o outro: com mais de um, dá pra
        // voltar pra escolha e trabalhar no que está em dia.
        onTrocar={lojas.length > 1 ? () => setQuerEscolher(true) : null}
        onSair={sair}
      />
    )
  }

  // `key` força o app a remontar inteiro quando troca de bar. Sem isso, o
  // tempo real continuaria recarregando o bar ANTIGO: o efeito que abre o
  // canal tem lista de dependências vazia, então ele guarda o donoId da
  // primeira montagem e nunca mais olha de novo.
  return (
    <App
      key={loja.id}
      distribuidora={loja}
      papel={papeis[loja.id] || 'dono'}
      lojas={lojas}
      onTrocarBar={lojas.length > 1 ? trocarBar : null}
      onSair={sair}
    />
  )
}

// Só aparece pra quem alcança mais de um bar, e só na primeira vez.
function EscolhaBar({ lojas, onEscolher, onSair }) {
  return (
    <div className="login-tela">
      <div className="login-caixa">
        <div className="login-logo">🍻</div>
        <h1 className="login-titulo">Qual bar?</h1>
        <p className="login-sub">Você pode trocar depois, lá no topo da tela.</p>

        <div className="escolha-bares">
          {lojas.map((l) => (
            <button key={l.id} className="escolha-bar" onClick={() => onEscolher(l.id)}>
              <span className="escolha-bar-nome">{l.nome}</span>
              {l.status !== 'ativa' && <span className="escolha-bar-tag">{l.status}</span>}
            </button>
          ))}
        </div>

        <button className="login-btn login-btn-fraco" onClick={onSair}>
          Sair
        </button>
      </div>
    </div>
  )
}

function Bloqueio({ emoji, titulo, texto, rodape, onTrocar, onSair }) {
  return (
    <div className="login-tela">
      <div className="login-caixa">
        <div className="login-logo">{emoji}</div>
        <h1 className="login-titulo">{titulo}</h1>
        <p className="login-sub">{texto}</p>
        {rodape && <p className="login-rodape">{rodape}</p>}
        {onTrocar && (
          <button className="login-btn" onClick={onTrocar}>
            Ver outro bar
          </button>
        )}
        <button className={onTrocar ? 'login-btn login-btn-fraco' : 'login-btn'} onClick={onSair}>
          Sair
        </button>
      </div>
    </div>
  )
}
