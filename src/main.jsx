import React from 'react'
import ReactDOM from 'react-dom/client'
import Portao from './Portao.jsx'
import './styles.css'

// ===========================================================================
//  ⚠️ FAIXA DE TESTE — TEMPORARIA, SAI ASSIM QUE O GEAN CONFIRMAR
// ===========================================================================
//  Existe por um motivo so: provar que uma mudanca feita no site aparece no
//  aplicativo JA INSTALADO, sem montar APK novo e sem passar por loja
//  nenhuma. E a resposta pratica pra pergunta "se eu mudar uma cor, chega no
//  app?".
//
//  Nao encosta em nada do Comanda: nao le banco, nao muda regra, nao entra no
//  fluxo de venda. E uma tarja por cima e mais nada.
//
//  DEPOIS DO TESTE: apagar este bloco e o <FaixaDeTeste /> la embaixo,
//  deixando o main.jsx como era (import, createRoot, Portao).
//  Esta faixa vive SO na branch `maquininha`. O `main` nunca a viu.
// ===========================================================================
const FaixaDeTeste = () => (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 999999,
      background: '#22c55e',
      color: '#04180b',
      font: '700 13px/1.35 system-ui, sans-serif',
      textAlign: 'center',
      padding: '8px 12px',
      letterSpacing: '.01em',
      boxShadow: '0 2px 10px rgba(0,0,0,.35)',
    }}
  >
    ✅ MUDEI DAQUI, SEM APK NOVO — publicado 28/08/2026 as 14:59
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FaixaDeTeste />
    <Portao />
  </React.StrictMode>
)
