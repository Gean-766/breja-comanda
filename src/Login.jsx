import { useState } from 'react'
import { supabase, LOGIN_DOMAIN } from './supabase.js'

// WhatsApp do suporte (você). Formato do wa.me: 55 + DDD + número.
const SUPORTE_ZAP = '5565996296391'

// Tela de entrada da distribuidora.
// Ela digita só o login (ex: "brejaecia") e a senha — o e-mail interno
// (login@comanda.local) é montado aqui e ela nunca vê. Sem código, sem
// confirmação por e-mail: o acesso é criado no painel CEO na hora da venda.
export default function Login() {
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)

  async function entrar(e) {
    e?.preventDefault()
    const usuario = login.trim().toLowerCase()
    if (!usuario || !senha) {
      setErro('Preencha o login e a senha.')
      return
    }
    setErro('')
    setEntrando(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: `${usuario}@${LOGIN_DOMAIN}`,
      password: senha,
    })
    setEntrando(false)
    if (error) setErro('Login ou senha incorretos.')
    // deu certo: o Portao percebe a sessão e troca de tela sozinho
  }

  return (
    <div className="login-tela">
      <form className="login-caixa" onSubmit={entrar}>
        <div className="login-logo">🍻</div>
        <h1 className="login-titulo">Comanda</h1>
        <p className="login-sub">Entre com o acesso do seu negócio</p>

        <input
          className="login-campo"
          placeholder="Login"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          inputMode="text"
        />
        <input
          className="login-campo"
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete="current-password"
        />

        <button className="login-btn" type="submit" disabled={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>

        {erro && <div className="login-erro">{erro}</div>}

        <p className="login-rodape">
          Não tem acesso ou esqueceu a senha? Fale com quem te vendeu o sistema:{' '}
          <a
            className="login-zap"
            href={`https://wa.me/${SUPORTE_ZAP}?text=${encodeURIComponent(
              'Oi! Preciso de ajuda com o acesso da Comanda.'
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 (65) 99629-6391
          </a>
        </p>
      </form>
    </div>
  )
}
