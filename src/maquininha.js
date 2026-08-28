// ===========================================================================
//  A PONTE COM A MAQUININHA
// ===========================================================================
//  Um lugar só, com um contrato só. O Comanda nunca fala com marca nenhuma:
//  ele pede "cobra R$ 47,50 no débito" e recebe de volta aprovado ou recusado.
//  Quem sabe conversar com Cielo, Stone, PagBank, Sicredi ou InfinitePay é o
//  adaptador nativo do lado de lá — e cada marca nova entra aqui como uma peça
//  pequena, sem mexer em mais nada.
//
//  ------------------------------------------------------------------------
//  REGRA QUE MANDA EM TUDO NESTE ARQUIVO
//  ------------------------------------------------------------------------
//  NO NAVEGADOR, NADA MUDA. Quem entra pelo link (o bar que está vendendo
//  hoje) roda exatamente o código de antes: `temMaquininha()` devolve false e
//  a venda segue o caminho de sempre, sem um passo a mais, sem um toque a
//  mais. A ponte só acorda dentro da casca Android.
//
//  Isso não é capricho: o bar do Adenilton trabalha todo dia com isto. Uma
//  ponte que aparecesse no navegador poderia travar a venda dele por causa de
//  uma máquina que ele nem tem.
//
//  ------------------------------------------------------------------------
//  ONDE ESTAMOS (28/08/2026)
//  ------------------------------------------------------------------------
//  Só existe o adaptador DE MENTIRA. Ele não cobra nada, não fala com máquina
//  nenhuma e não move um centavo: abre uma janelinha na tela onde a PESSOA
//  decide se aquela cobrança foi aprovada ou recusada.
//
//  Serve pra provar o caminho inteiro — principalmente o caminho da RECUSA,
//  que é o perigoso e que ninguém consegue testar de propósito com máquina de
//  verdade. Com ele dá pra fechar a Etapa 6 sem cadastro em adquirente
//  nenhuma e sem gastar um centavo.

// As duas formas que passam na maquininha. Dinheiro e Pix não passam: o
// dinheiro entra na gaveta e o Pix hoje é conferido no celular do dono.
const FORMAS_DE_CARTAO = new Set(['credito', 'debito'])

export const ehCartao = (forma) => FORMAS_DE_CARTAO.has(forma)

// ---------------------------------------------------------------------------
//  ESTAMOS DENTRO DA CASCA?
// ---------------------------------------------------------------------------
//  Três sinais, porque nenhum sozinho é confiável:
//
//  1. `window.Capacitor` — o que a casca injeta. É o sinal certo, mas depende
//     da versão do Capacitor e de a injeção ter acontecido antes deste código
//     rodar. Não dá pra depender só dele.
//  2. O carimbo no User-Agent — posto de propósito no capacitor.config.json
//     (`appendUserAgent`). Chega junto com a primeira requisição, então nunca
//     "ainda não carregou".
//  3. Uma chave no localStorage — pra eu e o Gean testarmos o fluxo no
//     navegador do PC, sem celular na mão. Só liga o simulador; não cobra
//     nada de ninguém.
export function temMaquininha() {
  if (typeof window === 'undefined') return false
  try {
    if (window.Capacitor?.isNativePlatform?.() === true) return true
    if (/\bComandaApp\//.test(navigator.userAgent || '')) return true
    // liga com: localStorage.setItem('comanda.maquininha', 'simular')
    return window.localStorage?.getItem('comanda.maquininha') === 'simular'
  } catch {
    // localStorage bloqueado (janela anônima, cookies desligados) não pode
    // derrubar a venda: no escuro, o certo é seguir como navegador comum.
    return false
  }
}

// ---------------------------------------------------------------------------
//  O SIMULADOR
// ---------------------------------------------------------------------------
//  Quem desenha a janelinha é o App (é lá que mora a tela). Ele se registra
//  aqui na abertura. Se por algum motivo não registrar, o `cobrar` abaixo não
//  trava a venda esperando pra sempre — cai no automático.
let _perguntarNaTela = null

export function registrarSimulador(fn) {
  _perguntarNaTela = typeof fn === 'function' ? fn : null
}

// ---------------------------------------------------------------------------
//  COBRAR
// ---------------------------------------------------------------------------
//  Recebe centavos (int) — nunca float. R$ 47,50 vira 4750. Dinheiro em
//  número quebrado é como se perde meio centavo por venda e ninguém acha
//  depois.
//
//  Devolve SEMPRE o mesmo formato, aprovado ou não:
//    { ok: true,  nsu, aut, bandeira, simulado }
//    { ok: false, motivo, simulado }
//
//  Nunca lança erro pra fora. Um `throw` aqui subiria no meio do fechamento de
//  uma comanda e deixaria a tela num estado que ninguém sabe explicar. Se algo
//  quebrar, isto vira uma recusa educada — que o Comanda já sabe tratar.
export async function cobrar({ centavos, forma, pedidoId = null }) {
  const valor = Math.round(Number(centavos) || 0)

  if (valor <= 0) {
    return { ok: false, motivo: 'Valor inválido para cobrança.', simulado: true }
  }

  try {
    // >>> Aqui entram os adaptadores de verdade, quando existirem:
    //     if (adaptadorDaMarca) return await adaptadorDaMarca.cobrar(...)
    //     Cada marca é uma peça nova; o resto deste arquivo não muda.

    if (_perguntarNaTela) {
      return await _perguntarNaTela({ centavos: valor, forma, pedidoId })
    }

    // Sem janelinha registrada: aprova sozinho depois de um respiro, só pra o
    // fluxo não morrer. Não é o caminho normal.
    await new Promise((r) => setTimeout(r, 1200))
    return { ok: true, nsu: null, aut: null, bandeira: null, simulado: true }
  } catch (e) {
    return {
      ok: false,
      motivo: 'A maquininha não respondeu.' + (e?.message ? ` (${e.message})` : ''),
      simulado: true,
    }
  }
}

// Reais (float, como o resto do app calcula) → centavos (int), que é o que
// toda adquirente pede. Arredonda uma vez só, no fim, e nunca pra baixo por
// erro de ponto flutuante: 47.499999... vira 4750, não 4749.
export const emCentavos = (reais) => Math.round((Number(reais) || 0) * 100)
