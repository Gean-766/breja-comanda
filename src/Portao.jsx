import { useEffect, useState } from 'react'
import { supabase, isConfigured } from './supabase.js'
import Login from './Login.jsx'
import App from './App.jsx'

// Portão de entrada do app:
//   sem sessão            -> tela de login
//   sessão sem cadastro   -> aviso (acesso criado torto no painel)
//   bloqueada ou vencida  -> tela de acesso expirado
//   tudo certo            -> o app da distribuidora
export default function Portao() {
  const [sessao, setSessao] = useState(undefined) // undefined = ainda checando
  const [distribuidora, setDistribuidora] = useState(undefined)

  // acompanha a sessão (fica salva no celular; não pede senha toda vez)
  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => setSessao(data?.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSessao(s || null)
      if (!s) setDistribuidora(undefined)
    })
    return () => sub?.subscription?.unsubscribe()
  }, [])

  // com sessão, busca a distribuidora dona desse login
  useEffect(() => {
    if (!sessao) return
    let vivo = true
    supabase
      .from('distribuidoras')
      .select('*')
      .eq('auth_user_id', sessao.user.id)
      .limit(1)
      .then(({ data }) => {
        if (vivo) setDistribuidora((data && data[0]) || null)
      })
    return () => {
      vivo = false
    }
  }, [sessao])

  async function sair() {
    await supabase.auth.signOut()
  }

  if (!isConfigured) return <App />
  if (sessao === undefined) return <div className="centro">Carregando…</div>
  if (!sessao) return <Login />
  if (distribuidora === undefined) return <div className="centro">Entrando…</div>

  if (!distribuidora) {
    return (
      <Bloqueio
        emoji="⚠️"
        titulo="Acesso não configurado"
        texto="Esse login existe, mas não está ligado a nenhuma distribuidora. Fale com quem te vendeu o sistema."
        onSair={sair}
      />
    )
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const vencido = distribuidora.vence_em && String(distribuidora.vence_em).slice(0, 10) < hoje
  const inativa = distribuidora.status !== 'ativa' && distribuidora.status !== 'teste'

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
        rodape={distribuidora.nome}
        onSair={sair}
      />
    )
  }

  return <App distribuidora={distribuidora} onSair={sair} />
}

function Bloqueio({ emoji, titulo, texto, rodape, onSair }) {
  return (
    <div className="login-tela">
      <div className="login-caixa">
        <div className="login-logo">{emoji}</div>
        <h1 className="login-titulo">{titulo}</h1>
        <p className="login-sub">{texto}</p>
        {rodape && <p className="login-rodape">{rodape}</p>}
        <button className="login-btn" onClick={onSair}>
          Sair
        </button>
      </div>
    </div>
  )
}
