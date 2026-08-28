// ===========================================================================
//  AVISO DE VERSÃO NOVA
// ===========================================================================
//  O PROBLEMA QUE ISTO RESOLVE, descoberto em 28/08/2026:
//
//  O Comanda guarda uma cópia de si mesmo no aparelho (service worker) pra
//  continuar funcionando quando a internet do bar engasga. Coisa boa — mas
//  tem um efeito colateral que ninguém via: ao publicar uma correção, o
//  aparelho que já tem a cópia antiga CONTINUA mostrando a antiga. A nova
//  desce por trás e só entra na abertura seguinte.
//
//  Na prática, no bar: o dono muda o preço da Skol às 20h e o garçom que está
//  com o app aberto continua vendendo pelo preço velho a noite inteira, sem
//  ninguém desconfiar de nada. Não é bug de código; é bug de quem não foi
//  avisado.
//
//  O QUE MUDA: em vez de trocar sozinho no escuro, o app avisa na tela que
//  existe versão nova e deixa a pessoa tocar pra atualizar. Quem está no meio
//  de um pedido termina o pedido; quem viu, atualiza na hora.
//
//  POR QUE NÃO ATUALIZAR SOZINHO NA CARA DELE: recarregar a tela no meio de
//  uma comanda sendo lançada é pior que a versão velha. O garçom perde o que
//  está fazendo e não entende por quê.

import { registerSW } from 'virtual:pwa-register'

// guardada aqui porque quem descobre a versão nova (este arquivo) e quem
// desenha o aviso (o App) são lugares diferentes
let _aplicar = null

// Chamado uma vez, na abertura. `aoTerNovaVersao` é o que acende o aviso.
export function ligarAvisoDeVersao(aoTerNovaVersao) {
  try {
    _aplicar = registerSW({
      immediate: true,
      onNeedRefresh() {
        aoTerNovaVersao?.()
      },
    })
  } catch {
    // Navegador sem suporte a service worker, ou registro bloqueado: o app
    // funciona igual, só não avisa. Nunca pode derrubar a tela por causa
    // disto — é um aviso, não é o sistema.
  }
}

// `true` = aplica a versão nova e recarrega. O reload direto é a rede de
// segurança pro caso de o registro não ter acontecido.
export function aplicarVersaoNova() {
  try {
    if (_aplicar) _aplicar(true)
    else window.location.reload()
  } catch {
    window.location.reload()
  }
}
