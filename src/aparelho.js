// ===========================================================================
//  QUAL APARELHO FEZ
// ===========================================================================
//  NASCEU DE UM CASO REAL (28/08/2026, Bola 7). A comanda do "Ceara" apareceu
//  fechada às 21:36 com R$ 96,00 no Pix. O garçom disse que não fechou, a
//  mulher dele disse que não fechou, o dono nem estava no bar. E não teve como
//  responder: o histórico guardava O QUE e QUANDO, mas não QUEM.
//
//  O bar inteiro entra com o mesmo login (`bola7`) em vários celulares, então
//  o login nunca ia distinguir. O que dá pra distinguir é o APARELHO.
//
//  ------------------------------------------------------------------------
//  POR QUE ISTO NÃO MEXE NO BANCO
//  ------------------------------------------------------------------------
//  A tabela `historico` já tem uma coluna `payload` (JSON livre). O aparelho
//  entra ali dentro, como mais uma chave. Nenhuma coluna nova, nenhum SQL pra
//  rodar, nada que possa falhar num bar que está vendendo. E o `reverter` lê
//  chaves específicas do payload (`cliente`, `consumo`, ...), então uma chave
//  a mais não atrapalha o desfazer.
//
//  ------------------------------------------------------------------------
//  O QUE ISTO **NÃO** RESOLVE — ler antes de confiar demais
//  ------------------------------------------------------------------------
//  - Identifica o APARELHO, não a pessoa. Dois garçons no mesmo celular
//    aparecem igual.
//  - Limpar os dados do app, reinstalar ou trocar de celular gera um código
//    novo. O aparelho "some" e aparece outro.
//  - Não é prova de nada contra ninguém. É pra responder "foi no balcão ou na
//    mesa?", não pra acusar funcionário.
//  - Não vale pra trás. O caso do Ceara continua sem resposta.

const CHAVE_ID = 'comanda.aparelho.id'
const CHAVE_NOME = 'comanda.aparelho.nome'

// Código curto e legível em voz alta ("aparelho A3F2"), porque quem vai usar
// isto é o dono lendo a tela e perguntando pro garçom — não um sistema.
// Sem 0/O e 1/I: numa tela pequena e num bar mal iluminado, ninguém acerta a
// diferença, e um código lido errado é pior que código nenhum.
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function sortearCodigo() {
  let s = ''
  const n = new Uint8Array(4)
  try {
    crypto.getRandomValues(n)
    for (const b of n) s += LETRAS[b % LETRAS.length]
  } catch {
    for (let i = 0; i < 4; i++) s += LETRAS[Math.floor(Math.random() * LETRAS.length)]
  }
  return s
}

// O código nasce na primeira vez que o aparelho abre o app e não muda mais
// (a não ser que limpem os dados). Se o localStorage estiver bloqueado, cai
// num código de sessão: some ao fechar, mas ainda separa dois aparelhos
// mexendo na mesma noite — que é justamente o caso que a gente quer enxergar.
let _sessao = null

export function idDoAparelho() {
  try {
    let id = localStorage.getItem(CHAVE_ID)
    if (!id) {
      id = sortearCodigo()
      localStorage.setItem(CHAVE_ID, id)
    }
    return id
  } catch {
    if (!_sessao) _sessao = sortearCodigo()
    return _sessao
  }
}

// Apelido opcional: "Balcão", "Garçom 1", "Celular do Adenilton". Muito mais
// útil que o código, mas é o dono que sabe qual é qual — por isso é ele quem
// escreve, na aba Histórico.
export function nomeDoAparelho() {
  try {
    return localStorage.getItem(CHAVE_NOME) || ''
  } catch {
    return ''
  }
}

export function batizarAparelho(nome) {
  try {
    const n = String(nome || '').trim().slice(0, 24)
    if (n) localStorage.setItem(CHAVE_NOME, n)
    else localStorage.removeItem(CHAVE_NOME)
  } catch {
    /* sem localStorage não dá pra guardar apelido; o código continua valendo */
  }
}

// O que vai junto de cada movimentação, dentro do payload.
export function carimboDoAparelho() {
  const nome = nomeDoAparelho()
  return nome ? { id: idDoAparelho(), nome } : { id: idDoAparelho() }
}

// Como aparece na tela do histórico: o apelido quando existe, senão o código.
export function comoMostrar(ap) {
  if (!ap || !ap.id) return null
  return ap.nome ? `${ap.nome} (${ap.id})` : ap.id
}
