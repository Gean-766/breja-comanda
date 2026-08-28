import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase, isConfigured } from './supabase.js'
import { temMaquininha, ehCartao, cobrar, emCentavos, registrarSimulador } from './maquininha.js'
import { ligarAvisoDeVersao, aplicarVersaoNova } from './atualizacao.js'

const money = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',')
const hora = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

// Cadeado de conexão: dá pra falar com o servidor (Supabase) AGORA? Faz um HEAD
// levíssimo em `cervejas` com prazo. Timeout ou erro de rede = caiu; qualquer
// resposta (mesmo erro de permissão) = servidor no ar. Rejeição = caiu.
async function pingConexao() {
  if (!isConfigured) return true
  try {
    const consulta = supabase.from('cervejas').select('id', { head: true }).limit(1)
    const prazo = new Promise((r) => setTimeout(() => r({ _timeout: true }), 4500))
    const res = await Promise.race([consulta, prazo])
    if (res && res._timeout) return false
    const msg = res && res.error ? res.error.message || '' : ''
    if (/fetch|network|timeout|failed|load failed/i.test(msg)) return false
    return true
  } catch (_) {
    return false
  }
}

// cores fixas das marcas mais conhecidas (pelo nome)
const CORES_CERVEJA = [
  { match: 'brahma', bg: '#c81f28', fg: '#ffffff' },
  { match: 'original', bg: '#e7b21c', fg: '#2a1d00' },
  { match: 'heineken', bg: '#15a03f', fg: '#ffffff' },
  { match: 'spaten', bg: '#11633a', fg: '#f4efe6' },
  { match: 'antarctica', bg: '#1566c0', fg: '#ffffff' },
]

// cor de texto que contrasta com um fundo hex
function fgPara(bg) {
  const h = String(bg).replace('#', '')
  if (h.length < 6) return '#ffffff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#2a1d00' : '#ffffff'
}

// cor do card: 1) cor escolhida no cadastro  2) marca conhecida  3) cor automática pelo nome
function corDe(nome, corSalva) {
  if (corSalva) return { bg: corSalva, fg: fgPara(corSalva) }
  const n = (nome || '').toLowerCase()
  const conhecida = CORES_CERVEJA.find((c) => n.includes(c.match))
  if (conhecida) return conhecida
  let h = 0
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360
  return { bg: `hsl(${h}, 52%, 40%)`, fg: '#ffffff' }
}

// paleta de cores pro lojista escolher
const PALETA = [
  '#c81f28', '#e7b21c', '#15a03f', '#11633a',
  '#1566c0', '#7b2ff7', '#e0533d', '#0c9c8f', '#555560',
]

// Módulos opcionais. O núcleo — Comandas, Produtos, Histórico — todo cliente tem.
// Estes ligam/desligam por distribuidora, marcados no painel CEO (coluna `modulos`).
// As chaves aqui têm que bater com as do painel (index.html do ceo-comanda).
const MODULOS = {
  estoque: {
    id: 'estoque', label: 'Estoque', icone: '📦',
    resumo: 'Entrada e saída de mercadoria, custo por caixa e aviso de estoque baixo.',
  },
  relatorio: {
    id: 'relatorio', label: 'Relatório', icone: '📊',
    resumo: 'Quanto vendeu no dia e na semana, produtos que mais saem e faturamento.',
  },
  cozinha: {
    id: 'cozinha', label: 'Cozinha', icone: '🍳',
    resumo: 'O pedido do garçom cai numa tela na cozinha e o cozinheiro marca "pronto".',
  },
}
const ORDEM_MODULOS = ['estoque', 'relatorio', 'cozinha']

// formas de pagamento: a chave (id) é o que fica salvo em clientes.forma_pagamento
// (comanda e venda rápida) e em pagamentos_parciais.forma (conta dividida).
// O rótulo/ícone é só pra tela.
const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icone: '💵' },
  { id: 'pix', label: 'Pix', icone: '⚡' },
  { id: 'credito', label: 'Crédito', icone: '💳' },
  { id: 'debito', label: 'Débito', icone: '🏧' },
]
// Venda fechada na época em que existia só "Cartão" (sem separar crédito de
// débito) continua legível no Relatório em vez de cair no monte do "Outro".
const FORMAS_ANTIGAS = { cartao: { label: 'Cartão', icone: '💳' } }
const formaDe = (id) => FORMAS_PAGAMENTO.find((f) => f.id === id) || FORMAS_ANTIGAS[id] || null
const rotuloForma = (id) => {
  const f = formaDe(id)
  return f ? `${f.icone} ${f.label}` : '• Outro'
}
// no papel do cupom o emoji sai borrado: lá vai só o nome
const nomeForma = (id) => {
  const f = formaDe(id)
  return f ? f.label : 'Outro'
}

// Dinheiro que fica na gaveta todo dia só pra dar troco. No fim do dia o que
// tem que estar lá é: esse fundo + as vendas em dinheiro. É o que deixa o dono
// conferir a gaveta sem fazer conta.
// (é só o valor SUGERIDO: quando o caixa é aberto, vale o que ele digitou lá)
const FUNDO_TROCO = 150

// ============================================================================
//  O DIA DO BAR  (turno de caixa)
// ============================================================================
// Bar não fecha à meia-noite. Quem está bebendo 01:30 ainda é do movimento da
// noite anterior — mas o relógio já virou o dia e o relatório começava do zero,
// cortando a noite no meio.
//
// Então "dia", aqui, não é o do calendário. É o TURNO, em duas camadas:
//
//   1) TURNO DE CAIXA (tabela `caixas`) — o dono abre quando começa a noite e
//      fecha quando o último sai. Tudo que acontece no meio pertence ao dia da
//      ABERTURA. É ele quem manda.
//
//   2) HORA DA VIRADA (05:00) — rede de segurança. Vale pra noite em que ele
//      esquecer de fechar e pra tudo que foi vendido antes deste recurso
//      existir. Passou das 05:00, o dia anterior se fecha sozinho e o próximo
//      começa: assim ele NUNCA acumula duas noites num relatório só.
//
// Nenhuma venda é apagada, movida ou reescrita — cada uma continua com o
// horário real em que aconteceu. O que muda é só a JANELA que o relatório lê.
// É por isso que as noites antigas se ajeitam sozinhas: a madrugada do dia 15
// volta a contar no dia 14 sem tocar em uma linha do banco.
const HORA_VIRADA = 5

const dd2 = (n) => String(n).padStart(2, '0')
const diaChave = (d) => `${d.getFullYear()}-${dd2(d.getMonth() + 1)}-${dd2(d.getDate())}`

// A que noite pertence um instante. Antes da virada, ainda é o dia anterior:
// 15/08 às 01:30, com virada às 05:00, é a noite do dia 14.
function diaDoBar(ts, virada = HORA_VIRADA) {
  const d = new Date(ts)
  d.setHours(d.getHours() - virada)
  return diaChave(d)
}

// 'AAAA-MM-DD' + n dias (passa por virada de mês/ano sozinho)
function somaDia(dia, n) {
  const [a, m, d] = String(dia).split('-').map(Number)
  return diaChave(new Date(a, m - 1, d + n))
}

// o instante da virada de um dia ('AAAA-MM-DD' às 05:00, hora do celular) em ms
function viradaDe(dia, virada = HORA_VIRADA) {
  const [a, m, d] = String(dia).split('-').map(Number)
  return new Date(a, m - 1, d, virada, 0, 0, 0).getTime()
}

const caixaAbertoDe = (caixas = []) => caixas.find((c) => !c.fechado_em) || null

// O último turno aberto naquela noite (dá pra abrir e fechar mais de uma vez).
function ultimoCaixaDe(caixas = [], dia) {
  let alvo = null
  for (const c of caixas) {
    if (String(c.dia) !== dia) continue
    if (!alvo || new Date(c.aberto_em) > new Date(alvo.aberto_em)) alvo = c
  }
  return alvo
}

// O PRIMEIRO turno da noite — o que começou a gaveta.
function primeiroCaixaDe(caixas = [], dia) {
  let alvo = null
  for (const c of caixas) {
    if (String(c.dia) !== dia) continue
    if (!alvo || new Date(c.aberto_em) < new Date(alvo.aberto_em)) alvo = c
  }
  return alvo
}

// Quantos turnos teve aquela noite (quase sempre 1).
function nTurnosDaNoite(caixas = [], dia) {
  let n = 0
  for (const c of caixas) if (String(c.dia) === dia) n++
  return n
}

// O troco que começou a gaveta daquela noite.
//
// Tem que ser o do PRIMEIRO turno, e isso não é detalhe. Quando ele fecha o
// caixa no meio da noite e reabre (o bar deu uma esvaziada às 21:34, encheu de
// novo às 22:42), o dinheiro do troco NÃO foi reposto — é a mesma gaveta, com
// as mesmas notas dentro. Na reabertura ele digita 0, porque não pôs nada.
//
// Pegando o último turno, o "Tem que ter na gaveta" mostrava R$ 0 de troco numa
// noite que começou com R$ 150 — e a conferência da gaveta acusaria R$ 150
// sobrando, um erro de troco que nunca existiu.
function fundoDaNoite(caixas = [], dia) {
  const pri = primeiroCaixaDe(caixas, dia)
  return pri && pri.fundo_troco != null ? Number(pri.fundo_troco) : FUNDO_TROCO
}

// Quando a noite acabou: no fechamento do caixa — ou, na falta dele, na virada.
// O `min` é a rede de segurança: mesmo esquecido, o dia nunca passa da virada.
function fimDoDia(dia, caixas, virada = HORA_VIRADA, agora = Date.now()) {
  const limite = viradaDe(somaDia(dia, 1), virada)
  const ult = ultimoCaixaDe(caixas, dia)
  const bruto = ult && ult.fechado_em ? new Date(ult.fechado_em).getTime() : agora
  return Math.min(bruto, limite)
}

// Janela [inicio, fim] em ms de uma noite. Uma noite começa exatamente onde a
// anterior terminou — de propósito: assim não existe brecha entre dois dias e
// nenhuma venda fica de fora de todo relatório.
function janelaDoDia(dia, caixas, virada = HORA_VIRADA, agora = Date.now()) {
  const inicio = fimDoDia(somaDia(dia, -1), caixas, virada, agora)
  const fim = Math.max(inicio, fimDoDia(dia, caixas, virada, agora))
  return { inicio, fim }
}

// Que noite está rolando AGORA (é o "Hoje" do relatório): o dia do bar do
// relógio, e ponto. Quem carimba a noite é a hora de ABRIR, e a virada das
// 05:00 já segura a madrugada na noite de ontem.
//
// AQUI MORAVA UM BUG QUE EMPURRAVA O BAR INTEIRO UM DIA PRA FRENTE.
// A regra antiga era "se o caixa desta noite já foi fechado, o que vier agora
// conta pra próxima". Parece razoável, mas ela olhava o caixa pelo RÓTULO — e
// um caixa rotulado 18/08 fechado às 01:13 é a noite do dia 17 terminando de
// madrugada, não a noite do 18 que já acabou. Resultado:
//
//   1) ele fechava o caixa 01:13 e reabria 02:00 (venda esquecida, segunda
//      rodada): a madrugada ainda era a mesma noite, mas o caixa novo nascia
//      com o rótulo do dia SEGUINTE;
//   2) na noite seguinte a conta se repetia em cima do rótulo já errado, e o
//      desvio virava permanente — cada noite carimbada um dia à frente, pra
//      sempre, sem ninguém mexer em nada;
//   3) no fim, o dia 18 aparecia no relatório com o faturamento do dia 17 e a
//      tela oferecia "abrir o caixa de 19/08" numa manhã de 18/08.
//
// O mesmo furo cortava a noite em duas quando ele fechava cedo (23:30) e
// reabria 23:50: a mesma noite ganhava dois rótulos.
//
// `caixas` continua na assinatura porque é assim que o resto do arquivo chama
// esta função — e porque o turno segue mandando em TUDO que é janela de
// relatório (ver `fimDoDia`/`janelaDoDia`). Só o carimbo da noite é que não
// depende mais dele.
function diaAtualDoBar(caixas, virada = HORA_VIRADA, agora = Date.now()) {
  return diaDoBar(agora, virada)
}

// `distribuidora` e `onSair` vêm do Portao.jsx (quem já passou pelo login).
// O RLS do banco já isola os dados por distribuidora; os filtros por
// distribuidora_id aqui embaixo são só uma segunda tranca.
export default function App({ distribuidora = null, onSair = null }) {
  const donoId = distribuidora?.id || null
  // abas extras que esse cliente contratou (vêm ligadas do painel CEO)
  const modulos = Array.isArray(distribuidora?.modulos) ? distribuidora.modulos : []
  const abasExtra = ORDEM_MODULOS.filter((k) => modulos.includes(k) && MODULOS[k])
  // com Estoque ligado, ele vira o gerenciador de produtos e a aba Produtos some
  // (evita cadastrar o mesmo produto em dois lugares e duplicar)
  const temEstoque = modulos.includes('estoque')
  // comanda por mesa (Mesa 3) ou por pessoa (Alex) — configurado no painel CEO
  const modoMesa = distribuidora?.modo_comanda === 'mesa'
  // hora em que a noite de ontem finalmente acaba (ver "O DIA DO BAR" lá em cima).
  // Vem da loja (coluna `hora_virada`); sem ela, 05:00.
  const virada =
    distribuidora?.hora_virada != null && Number.isFinite(Number(distribuidora.hora_virada))
      ? Number(distribuidora.hora_virada)
      : HORA_VIRADA
  const [aba, setAba] = useState('comandas') // núcleo: 'comandas' | 'cervejas' | 'historico' + módulos
  const [cervejas, setCervejas] = useState([])
  const [clientes, setClientes] = useState([])
  const [consumos, setConsumos] = useState([])
  const [historico, setHistorico] = useState([])
  const [entradas, setEntradas] = useState([]) // entradas de estoque (módulo Estoque)
  const [pagas, setPagas] = useState([]) // comandas já pagas nos últimos 30d (módulo Relatório)
  const [parciais, setParciais] = useState([]) // pagamentos parciais das comandas abertas (conta dividida)
  const [perdas, setPerdas] = useState([]) // perdas: quebra/vencimento/estrago (módulo Estoque)
  const [caixas, setCaixas] = useState([]) // turnos de caixa (abertura/fechamento do dia)
  const [caixaSheet, setCaixaSheet] = useState(null) // folha de abrir/fechar o caixa
  const [temCaixas, setTemCaixas] = useState(false) // a tabela `caixas` já existe no banco?
  const [busca, setBusca] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [abertoId, setAbertoId] = useState(null) // cliente aberto na tela de detalhe
  const [balcaoAberto, setBalcaoAberto] = useState(false) // overlay da venda rápida (balcão)
  const [carregando, setCarregando] = useState(true)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef()
  const [conexaoRuim, setConexaoRuim] = useState(false) // cadeado: trava quando a internet cai
  const travadoRef = useRef(false)

  function mostrarToast(msg, opts = {}) {
    clearTimeout(toastTimer.current)
    setToast({ msg, tipo: opts.tipo || 'info', acao: opts.acao || null, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), opts.acao ? 6000 : 3500)
  }
  const erro = (msg) => mostrarToast(msg, { tipo: 'erro' })

  // ==================== MAQUININHA ====================
  // A regra que manda aqui: DINHEIRO NÃO SE MARCA COMO RECEBIDO ANTES DE
  // ENTRAR. Até hoje a comanda fechava no toque do botão — com a maquininha no
  // meio isso deixaria a comanda fechada e a gaveta furada toda vez que uma
  // transação fosse recusada, e ninguém veria o erro acontecer.
  //
  // `cobrarSePreciso` é o pedágio: as TRÊS portas por onde entra dinheiro
  // (fechar comanda, venda de balcão e conta dividida) passam por aqui antes
  // de escrever qualquer coisa no banco.
  const [maqPedido, setMaqPedido] = useState(null) // a janelinha do simulador

  // Versão nova publicada: acende uma tarja discreta em vez de trocar a tela
  // no meio de um pedido. Ver src/atualizacao.js pro porquê.
  const [temVersaoNova, setTemVersaoNova] = useState(false)
  useEffect(() => {
    ligarAvisoDeVersao(() => setTemVersaoNova(true))
  }, [])

  // O simulador vive no App porque é ele que tem tela. A ponte só o chama.
  useEffect(() => {
    registrarSimulador(
      ({ centavos, forma }) =>
        new Promise((resolver) => setMaqPedido({ centavos, forma, resolver }))
    )
    return () => registrarSimulador(null)
  }, [])

  // Devolve true = pode seguir e gravar. false = NÃO grava nada.
  //
  // Quem não passa pela maquininha (dinheiro, Pix, navegador comum, ou
  // pagamento de noite passada que já entrou lá atrás) devolve true na hora,
  // sem um passo a mais. É isso que mantém o bar de hoje funcionando igual.
  async function cobrarSePreciso(forma, valorEmReais) {
    if (!ehCartao(forma)) return true
    if (!temMaquininha()) return true
    const centavos = emCentavos(valorEmReais)
    if (centavos <= 0) return true
    const r = await cobrar({ centavos, forma })
    if (r?.ok) {
      mostrarToast(
        'Aprovado ✓' + (r.simulado ? ' (simulação)' : '') + (r.nsu ? ` · NSU ${r.nsu}` : ''),
        { tipo: 'ok' }
      )
      return true
    }
    // Recusou: a comanda continua ABERTA, de propósito. É o ponto inteiro
    // desta mudança — o freguês tenta outro cartão e nada se perdeu.
    erro('❌ ' + (r?.motivo || 'Pagamento não aprovado.') + ' A comanda continua aberta.')
    return false
  }

  async function carregar() {
    if (!isConfigured) {
      setCarregando(false)
      return
    }
    const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    // só as linhas desta distribuidora
    const meu = (q) => (donoId ? q.eq('distribuidora_id', donoId) : q)
    const [c1, c2, c3, c4] = await Promise.all([
      meu(supabase.from('cervejas').select('*')).eq('ativo', true).order('ordem'),
      meu(supabase.from('clientes').select('*')).eq('aberto', true).order('created_at'),
      meu(supabase.from('consumos').select('*')).order('created_at', { ascending: false }),
      meu(supabase.from('historico').select('*'))
        .gte('created_at', desde24h)
        .order('created_at', { ascending: false }),
    ])
    setCervejas(c1.data || [])
    setClientes(c2.data || [])
    setConsumos(c3.data || [])
    setHistorico(c4.data || [])
    setCarregando(false)

    // Turnos de caixa (abrir/fechar o dia). Select à parte, como os de baixo:
    // enquanto o SQL `caixa-turno.sql` não tiver rodado, a tabela não existe,
    // o erro morre aqui e o app segue funcionando pela hora da virada.
    // Em erro (rede), mantém a lista que já estava — melhor a informação de um
    // segundo atrás do que o app achar que o caixa fechou sozinho.
    const rcx = await meu(supabase.from('caixas').select('*'))
      .order('aberto_em', { ascending: false })
      .limit(120)
    if (!rcx.error) {
      setCaixas(rcx.data || [])
      setTemCaixas(true)
    }

    // Estoque só carrega se o módulo estiver ligado. Fica num select à parte
    // (não no Promise.all) pra que, se a tabela ainda não existir no banco,
    // o erro morra aqui e não derrube o resto do carregamento.
    if (abasExtra.includes('estoque')) {
      const qe = meu(supabase.from('estoque_entradas').select('*'))
      const re = await qe.order('created_at', { ascending: false })
      setEntradas(re.data || [])

      // Perdas (quebra/vencimento): à parte também, pra degradar sozinho se a
      // tabela ainda não existir no banco (até rodar o SQL perdas.sql).
      const rperdas = await meu(supabase.from('perdas').select('*'))
        .order('created_at', { ascending: false })
        .limit(500)
      setPerdas(rperdas.error ? [] : rperdas.data || [])
    }

    // Conta dividida: pagamentos parciais. São dois recortes — as comandas ainda
    // ABERTAS (a tela da mesa precisa delas, por mais velha que seja a comanda)
    // e, com o Relatório ligado, os últimos 30 dias: o caixa precisa saber por
    // qual forma cada parte entrou, inclusive de comanda já fechada. Fica à parte
    // (fora do Promise.all) pra não derrubar o resto se a tabela ainda não
    // existir no banco — o app degrada sozinho até rodar o SQL.
    // Quanto tempo pra trás carregar o que já foi PAGO: o Relatório pede 30
    // dias (é o maior período dele); sem o Relatório ligado, 3 dias bastam —
    // é o que a folha de fechamento do caixa precisa pra dizer quanto entrou
    // na noite. Sem isso, quem não tem o módulo veria "Recebido R$ 0,00".
    const diasPagos = abasExtra.includes('relatorio') ? 30 : 3
    const desdePagos = new Date(Date.now() - diasPagos * 24 * 60 * 60 * 1000).toISOString()

    const abertosIds = (c2.data || []).map((c) => c.id)
    const baldes = []
    if (abertosIds.length) {
      baldes.push(await meu(supabase.from('pagamentos_parciais').select('*')).in('cliente_id', abertosIds))
    }
    baldes.push(await meu(supabase.from('pagamentos_parciais').select('*')).gte('created_at', desdePagos))
    const parciaisPorId = new Map()
    for (const b of baldes) for (const p of b.error ? [] : b.data || []) parciaisPorId.set(p.id, p)
    setParciais([...parciaisPorId.values()])

    // Comandas JÁ PAGAS: é delas que sai o "recebido" (as abertas já vêm em
    // `clientes`). Serve pro Relatório e pra folha de fechamento do caixa.
    const rp = await meu(supabase.from('clientes').select('*'))
      .eq('aberto', false)
      .gte('pago_em', desdePagos)
      .order('pago_em', { ascending: false })
    if (!rp.error) setPagas(rp.data || [])
  }

  // grava uma linha no histórico (auditoria + permite desfazer).
  // "autor" fica null por ora; entra quando houver login dos garçons.
  async function registrar(tipo, descricao, payload = {}) {
    try {
      const { data } = await supabase
        .from('historico')
        .insert({ tipo, descricao, payload })
        .select()
        .single()
      return data
    } catch (_) {
      /* histórico é secundário: nunca bloqueia a ação principal */
      return null
    }
  }

  // carga inicial + sincronização em tempo real entre celulares
  useEffect(() => {
    carregar()
    if (!isConfigured) return
    let t
    const recarregar = () => {
      clearTimeout(t)
      t = setTimeout(carregar, 400) // junta várias mudanças seguidas
    }
    const canal = supabase
      .channel('comanda-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consumos' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cervejas' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historico' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estoque_entradas' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagamentos_parciais' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'perdas' }, recarregar)
      .subscribe()

    // Rede de segurança pro caso do tempo real cair (celular parado/bloqueado).
    // Recarrega ao voltar pro app — isso é imediato e é o que mais importa — e,
    // enquanto a tela fica aberta, de tempos em tempos.
    //
    // Era de 4 em 4 segundos. Cada recarga são 10 consultas, então dava ~9.000
    // por hora em CADA celular, com o tamanho crescendo junto com o histórico de
    // vendas. Como o tempo real já avisa de qualquer mudança em menos de um
    // segundo, isto aqui é só o plano B: 15s dá a mesma proteção e derruba três
    // quartos do tráfego. Voltar pro app continua recarregando na hora.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') carregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('focus', aoVoltar)
    const intervalo = setInterval(aoVoltar, 15000)

    return () => {
      clearTimeout(t)
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('focus', aoVoltar)
      supabase.removeChannel(canal)
    }
  }, [])

  // Tempo real do caixa (abriu/fechou num celular, aparece nos outros) num
  // canal SEPARADO, e só depois de confirmar que a tabela existe: assim, se o
  // app subir antes do SQL rodar, o tempo real das comandas não vem junto abaixo.
  useEffect(() => {
    if (!isConfigured || !temCaixas) return
    const canal = supabase
      .channel('comanda-caixas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caixas' }, () => carregar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [temCaixas])

  // mantém a ref em dia pra o cadeado ler o estado sem re-disparar o efeito
  useEffect(() => {
    travadoRef.current = conexaoRuim
  }, [conexaoRuim])

  // CADEADO DE CONEXÃO: enquanto o celular não estiver falando com o servidor,
  // trava a tela (ninguém cobra em cima de comanda desatualizada). Ao voltar,
  // recarrega tudo e destrava. É por celular — cada um checa a própria conexão.
  useEffect(() => {
    if (!isConfigured) return
    let vivo = true
    let falhas = 0
    let travarTimer = null
    const trava = () => {
      if (travarTimer || travadoRef.current) return
      // folga: só trava depois de ~4,5s de queda confirmada (não pisca em engasgo)
      travarTimer = setTimeout(() => {
        travarTimer = null
        if (vivo) setConexaoRuim(true)
      }, 4500)
    }
    const libera = () => {
      if (travarTimer) {
        clearTimeout(travarTimer)
        travarTimer = null
      }
      if (travadoRef.current && vivo) carregar() // estava travado → põe em dia antes de liberar
      if (vivo) setConexaoRuim(false)
    }
    async function checar() {
      if (!vivo) return
      if (!navigator.onLine) {
        trava()
        return
      }
      const ok = await pingConexao()
      if (!vivo) return
      if (ok) {
        falhas = 0
        libera()
      } else {
        falhas += 1
        trava()
      }
    }
    checar()
    const iv = setInterval(checar, 5000)
    const onNet = () => checar()
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onNet)
    return () => {
      vivo = false
      clearInterval(iv)
      if (travarTimer) clearTimeout(travarTimer)
      window.removeEventListener('online', onNet)
      window.removeEventListener('offline', onNet)
    }
  }, [])

  // limpeza: o histórico fica 24h no app, mas ~30 dias no banco.
  // ao abrir o app, apaga o que passou de 30 dias (uma vez).
  useEffect(() => {
    if (!isConfigured) return
    const ha30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    let q = supabase.from('historico').delete().lt('created_at', ha30dias)
    if (donoId) q = q.eq('distribuidora_id', donoId)
    q.then(() => {})
  }, [donoId])

  // desfazer uma movimentação: cada tipo tem sua ação inversa.
  async function reverter(h) {
    if (!h || h.revertido) return
    if (!h._semConfirm && !confirm(`Desfazer: "${h.descricao}"?`)) return
    const p = h.payload || {}
    try {
      if (h.tipo === 'excluir_cliente') {
        // recria a pessoa (mesmo id) e todo o consumo dela
        await supabase.from('clientes').insert({
          id: p.cliente.id,
          nome: p.cliente.nome,
          aberto: true,
          pago_em: null,
          created_at: p.cliente.created_at,
        })
        if (p.consumos?.length) await supabase.from('consumos').insert(p.consumos)
        // os pagamentos parciais também caem por cascata: sem isto, desfazer
        // devolveria a comanda mas não o dinheiro que já tinha entrado
        if (p.parciais?.length) await supabase.from('pagamentos_parciais').insert(p.parciais)
      } else if (h.tipo === 'abrir_cliente') {
        // desfazer a abertura apaga a comanda — e a cascata do banco levaria
        // junto o que foi lançado e o que já foi pago nela
        const temItens = consumos.some((c) => c.cliente_id === p.cliente.id)
        const temPago = parciais.some((x) => x.cliente_id === p.cliente.id)
        if (temItens || temPago) {
          erro('Essa comanda já tem lançamento ou pagamento. Feche ou esvazie ela antes.')
          return
        }
        await supabase.from('clientes').delete().eq('id', p.cliente.id)
      } else if (h.tipo === 'fechar_cliente') {
        await supabase
          .from('clientes')
          .update({ aberto: true, pago_em: null })
          .eq('id', p.cliente.id)
      } else if (h.tipo === 'lancar_consumo') {
        await supabase.from('consumos').delete().eq('id', p.consumo.id)
      } else if (h.tipo === 'remover_consumo') {
        await supabase.from('consumos').insert(p.consumo)
      } else if (h.tipo === 'add_produto') {
        // apagar o produto leva junto, por cascata, a contagem de estoque dele;
        // e as vendas já feitas ficariam órfãs (elas guardam o nome, não o id)
        const ids = p.ids || []
        const nomes = cervejas.filter((c) => ids.includes(c.id)).map((c) => reprProduto(c))
        const temEntrada = entradas.some((e) => ids.includes(e.cerveja_id))
        const temVenda = consumos.some((co) => nomes.includes(co.beer_nome))
        if (temEntrada || temVenda) {
          erro('Esse produto já tem estoque contado ou venda. Use o ✕ no card dele.')
          return
        }
        await supabase.from('cervejas').delete().in('id', ids)
      } else if (h.tipo === 'remover_produto') {
        await supabase.from('cervejas').update({ ativo: true }).eq('id', p.produto.id)
      } else if (h.tipo === 'editar_produto') {
        // voltar o nome do produto é renomear: o histórico de vendas tem que ir
        // junto, senão as saídas antigas param de descontar do estoque
        const atual = cervejas.find((c) => c.id === p.id)
        const de = atual ? reprProduto(atual) : null
        const para = p.antes.tamanho ? `${p.antes.nome} ${p.antes.tamanho}` : p.antes.nome
        await supabase
          .from('cervejas')
          .update({ nome: p.antes.nome, tamanho: p.antes.tamanho })
          .eq('id', p.id)
        if (de && de !== para) {
          await supabase.from('consumos').update({ beer_nome: para }).eq('beer_nome', de)
          await supabase.from('perdas').update({ beer_nome: para }).eq('beer_nome', de)
        }
      } else if (h.tipo === 'mudar_preco') {
        await supabase.from('cervejas').update({ preco: p.antes }).eq('id', p.id)
      } else if (h.tipo === 'venda_balcao') {
        // apaga a venda de balcão (a comanda fechada + os consumos, em cascata)
        await supabase.from('clientes').delete().eq('id', p.cliente.id)
      } else if (h.tipo === 'pagar_parte') {
        await supabase.from('pagamentos_parciais').delete().eq('id', p.parcial.id)
      } else if (h.tipo === 'renomear_cliente') {
        await supabase.from('clientes').update({ nome: p.antes }).eq('id', p.id)
      } else if (h.tipo === 'perda') {
        await supabase.from('perdas').delete().eq('id', p.id)
      } else if (h.tipo === 'abrir_caixa') {
        // desfazer a abertura é só apagar o turno: nenhuma venda aponta pra ele
        // (o caixa é uma janela de horário, não um dono das vendas)
        await supabase.from('caixas').delete().eq('id', p.caixa.id)
      } else if (h.tipo === 'fechar_caixa') {
        // reabrir a noite. Se já tem outro caixa aberto, o banco recusa — e é
        // certo que recuse: dois caixas abertos ao mesmo tempo bagunçariam o dia.
        const r = await supabase
          .from('caixas')
          .update({ fechado_em: null, contado: null })
          .eq('id', p.caixa.id)
        if (r.error) {
          erro('Já tem um caixa aberto agora. Feche ele antes de reabrir esta noite.')
          return
        }
      } else {
        return
      }
      await supabase.from('historico').update({ revertido: true }).eq('id', h.id)
      await carregar()
      mostrarToast('Desfeito ✓', { tipo: 'ok' })
    } catch (_) {
      erro('⚠️ Não consegui desfazer. Tente de novo.')
    }
  }

  // total e quantidade por cliente
  const resumo = useMemo(() => {
    const m = {}
    for (const cl of clientes) m[cl.id] = { total: 0, qtd: 0 }
    for (const co of consumos) {
      if (!m[co.cliente_id]) continue
      m[co.cliente_id].total += Number(co.preco_unit) * co.quantidade
      m[co.cliente_id].qtd += co.quantidade
    }
    return m
  }, [clientes, consumos])

  const clientesFiltrados = clientes.filter((c) =>
    c.nome.toLowerCase().includes(busca.trim().toLowerCase())
  )

  // Saldo do estoque por produto. É o que deixa o app avisar, NA HORA DE
  // LANÇAR, que aquele produto acabou — ver `avisoEstoque`. Só existe com o
  // módulo Estoque ligado, porque é ele que carrega as entradas; sem contagem
  // não há saldo pra comparar e o app não tem o que reclamar.
  const estoquePorId = useMemo(() => {
    const m = new Map()
    if (!temEstoque) return m
    for (const it of calcularEstoque(cervejas, entradas, consumos, perdas))
      m.set(it.c.id, { controlado: it.controlado, saldo: it.saldo })
    return m
  }, [temEstoque, cervejas, entradas, consumos, perdas])

  async function adicionarPessoa() {
    let nome = novoNome.trim()
    if (!nome) return
    // no modo mesa, "3" vira "Mesa 3" (mas deixa passar texto livre tipo "Balcão")
    if (modoMesa && /^\d+$/.test(nome)) nome = 'Mesa ' + nome
    const { data, error } = await supabase
      .from('clientes')
      .insert({ nome })
      .select()
      .single()
    if (error || !data) {
      erro('⚠️ Não consegui abrir a comanda. Sem conexão?')
      return
    }
    setNovoNome('')
    setClientes((cs) => [...cs, data])
    setAbertoId(data.id)
    registrar('abrir_cliente', `Abriu a comanda de ${nome}`, { cliente: data })
  }

  async function adicionarConsumo(cliente_id, cerveja, quantidade) {
    const { data, error } = await supabase
      .from('consumos')
      .insert({
        cliente_id,
        beer_nome: cerveja.tamanho ? `${cerveja.nome} ${cerveja.tamanho}` : cerveja.nome,
        preco_unit: cerveja.preco,
        quantidade,
      })
      .select()
      .single()
    if (error || !data) {
      erro('⚠️ Não salvou o lançamento. Tente de novo.')
      return
    }
    setConsumos((cs) => [data, ...cs])
    const cli = clientes.find((c) => c.id === cliente_id)
    registrar(
      'lancar_consumo',
      `+${quantidade}× ${data.beer_nome}${cli ? ' — ' + cli.nome : ''}`,
      { consumo: data }
    )
  }

  async function removerConsumo(id) {
    const item = consumos.find((c) => c.id === id)
    setConsumos((cs) => cs.filter((c) => c.id !== id)) // tira na hora
    const { error } = await supabase.from('consumos').delete().eq('id', id)
    if (error) {
      if (item) setConsumos((cs) => [item, ...cs]) // volta se falhou
      erro('⚠️ Não consegui remover. Sem conexão?')
      return
    }
    if (!item) return
    const cli = clientes.find((c) => c.id === item.cliente_id)
    const h = await registrar(
      'remover_consumo',
      `−${item.quantidade}× ${item.beer_nome}${cli ? ' — ' + cli.nome : ''}`,
      { consumo: item }
    )
    // O desfazer do toast é o MESMO do Histórico. Antes ele inseria uma cópia
    // nova do item: quem usasse os dois ficava com a venda em dobro — estoque
    // baixando duas vezes e faturamento inflado. Passando pelo `reverter`, a
    // linha volta com o id original e o histórico fica marcado como desfeito,
    // então o segundo clique não faz nada.
    mostrarToast('Item removido', {
      acao: h ? { label: '↩ Desfazer', fn: () => reverter({ ...h, _semConfirm: true }) } : null,
    })
  }

  // `noiteRetro` ('AAAA-MM-DD') é a CORREÇÃO DE ESQUECIMENTO: o freguês pagou
  // naquela noite, mas a comanda ficou aberta no app. Sem ela, o dinheiro cairia
  // no caixa de hoje e as duas noites ficariam erradas — a de ontem com sobra na
  // gaveta que ninguém explica, a de hoje com uma entrada que nunca aconteceu.
  //
  // O pagamento é carimbado no fim daquela noite — o instante em que o caixa
  // dela fechou (ou a virada, se ficou esquecido aberto): é exatamente onde ele
  // teria sido contado se a comanda tivesse sido fechada na hora.
  //
  // O SEGUNDO A MENOS não é frescura. As janelas das noites são coladas de
  // propósito (o fim de uma é o começo da outra, pra nenhuma venda cair numa
  // brecha) e as duas pontas contam. Uma venda de verdade nunca acontece no
  // instante exato da virada, mas este carimbo cairia bem ali — e os mesmos
  // R$ 58 entrariam NAS DUAS noites. Um segundo antes é o que o mantém dentro
  // de uma só.
  async function fecharConta(cliente_id, forma = null, noiteRetro = null) {
    const cli = clientes.find((c) => c.id === cliente_id)
    const r = resumo[cliente_id] || { total: 0, qtd: 0 }
    // MAQUININHA. Vem antes de tocar no banco: se recusar, a comanda tem que
    // continuar aberta como se nada tivesse sido tentado.
    //
    // Cobra o que FALTA, não o total: numa conta dividida os amigos já pagaram
    // pedaços, e é exatamente o "falta pagar" que a tela mostra na hora de
    // confirmar. Cobrar `r.total` aqui passaria o valor cheio no cartão do
    // último — dinheiro a mais na mão do freguês errado.
    //
    // `noiteRetro` NÃO passa pela máquina de propósito: é a correção de
    // esquecimento — o freguês pagou naquela noite e a comanda só ficou aberta
    // no app. Cobrar de novo agora seria cobrar duas vezes o mesmo consumo.
    const jaPago = parciais
      .filter((p) => p.cliente_id === cliente_id)
      .reduce((s, p) => s + Number(p.valor || 0), 0)
    const aCobrar = Math.max(0, r.total - jaPago)
    if (!noiteRetro && !(await cobrarSePreciso(forma, aCobrar))) return

    const pago_em = new Date(
      noiteRetro ? fimDoDia(noiteRetro, caixas, virada) - 1000 : Date.now()
    ).toISOString()
    // tenta gravar a forma; se a coluna ainda não existe no banco, fecha sem ela
    // (assim o fechar nunca quebra antes de rodar o SQL do financeiro)
    let upd = await supabase
      .from('clientes')
      .update({ aberto: false, pago_em, forma_pagamento: forma })
      .eq('id', cliente_id)
    if (upd.error && /forma_pagamento/i.test(upd.error.message || '')) {
      upd = await supabase
        .from('clientes')
        .update({ aberto: false, pago_em })
        .eq('id', cliente_id)
    }
    // sem esta checagem, uma falha de rede tirava a comanda da tela mas ela
    // continuava ABERTA no banco: o garçom achava que fechou e o dinheiro
    // ficava fora do caixa até alguém reparar
    if (upd.error) {
      erro('⚠️ Não consegui fechar a comanda. Sem conexão? Tente de novo.')
      return
    }
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    // já joga na lista de pagas pro Relatório refletir na hora
    if (cli) setPagas((ps) => [{ ...cli, aberto: false, pago_em, forma_pagamento: forma }, ...ps])
    setAbertoId(null)
    setBusca('')
    if (cli)
      registrar(
        'fechar_cliente',
        `Fechou/pagou a comanda de ${cli.nome} (${money(r.total)}${forma ? ' · ' + rotuloForma(forma) : ''})` +
          // deixa rastro da correção: quem olhar o histórico depois precisa ver
          // que esse dinheiro foi lançado numa noite que já tinha sido fechada
          (noiteRetro ? ` — lançado na noite de ${diaBonito(noiteRetro)}` : ''),
        { cliente: cli }
      )
  }

  // ATENÇÃO: apagar a comanda leva junto, POR CASCATA NO BANCO, as vendas
  // (consumos) e os pagamentos já recebidos (pagamentos_parciais). Ou seja:
  // dinheiro que já entrou na gaveta sumiria do caixa e as bebidas que saíram
  // da geladeira voltariam a contar como estoque. As travas abaixo existem
  // porque isso é um rombo silencioso — ninguém vê o erro acontecer.
  async function excluirCliente(cliente_id) {
    // captura tudo ANTES de apagar, pra conseguir restaurar depois
    const cli = clientes.find((c) => c.id === cliente_id)
    const cons = consumos.filter((c) => c.cliente_id === cliente_id)
    const pagos = parciais.filter((p) => p.cliente_id === cliente_id)
    const jaPago = pagos.reduce((s, p) => s + Number(p.valor || 0), 0)
    const total = cons.reduce((s, c) => s + Number(c.preco_unit) * c.quantidade, 0)

    if (jaPago > 0.009) {
      alert(
        `Não dá pra excluir: esta comanda já recebeu ${money(jaPago)}.\n\n` +
          `Apagar aqui faria esse dinheiro sumir do caixa e as bebidas voltarem pro estoque.\n\n` +
          `• Se ele pagou tudo, use "✓ Receber o resto".\n` +
          `• Se ficou devendo, deixe a comanda aberta — ela aparece em "Em aberto agora" no Relatório.`
      )
      return
    }
    if (cons.length > 0) {
      const ok = confirm(
        `Excluir a comanda de ${cli ? cli.nome : ''}?\n\n` +
          `Isso apaga ${cons.length} lançamento${cons.length === 1 ? '' : 's'} (${money(total)}) e ` +
          `devolve as bebidas pro estoque, como se nunca tivessem saído.\n\n` +
          `Use só se a comanda foi aberta por engano. Se a pessoa levou e não pagou, ` +
          `feche pelo botão de pagamento.`
      )
      if (!ok) return
    }

    await supabase.from('clientes').delete().eq('id', cliente_id)
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    setAbertoId(null)
    setBusca('')
    if (cli) {
      const h = await registrar(
        'excluir_cliente',
        `Excluiu a comanda de ${cli.nome} (${cons.length} lançamento${cons.length === 1 ? '' : 's'})`,
        { cliente: cli, consumos: cons, parciais: pagos }
      )
      mostrarToast(`${cli.nome} excluído`, {
        acao: h
          ? { label: '↩ Desfazer', fn: () => reverter({ ...h, _semConfirm: true }) }
          : null,
      })
    }
  }

  // Renomear a comanda (o lápis na tela da mesa). Ex.: Fernando saiu, entrou Gustavo.
  async function renomearCliente(cliente_id, novoNome) {
    let nome = (novoNome || '').trim()
    if (!nome) return
    if (modoMesa && /^\d+$/.test(nome)) nome = 'Mesa ' + nome
    const cli = clientes.find((c) => c.id === cliente_id)
    const antes = cli?.nome
    if (nome === antes) return
    setClientes((cs) => cs.map((c) => (c.id === cliente_id ? { ...c, nome } : c)))
    const { error } = await supabase.from('clientes').update({ nome }).eq('id', cliente_id)
    if (error) {
      setClientes((cs) => cs.map((c) => (c.id === cliente_id ? { ...c, nome: antes } : c)))
      erro('⚠️ Não consegui renomear. Sem conexão?')
      return
    }
    registrar('renomear_cliente', `Renomeou "${antes}" → "${nome}"`, { id: cliente_id, antes })
  }

  // Ao sair de uma comanda (‹ Voltar):
  //  - totalmente paga (dividida e quitada) → fecha (sai da lista de abertas).
  //  - senão, continua aberta — inclusive vazia.
  //
  // Comanda vazia FICA, de propósito: o dono deixa o card dos fregueses de
  // todo dia (Alemão, Pedro) pronto de manhã e só lança quando eles chegam.
  // Antes ela era apagada aqui ("faxina"); agora nome digitado errado sai
  // no "✕ Excluir" da própria comanda, que pede confirmação, registra no
  // histórico e dá pra desfazer.
  async function sairDaComanda() {
    const id = abertoId
    setAbertoId(null)
    setBusca('')
    if (!id) return
    const total = resumo[id]?.total || 0
    const pagoP = parciais
      .filter((p) => p.cliente_id === id)
      .reduce((s, p) => s + Number(p.valor || 0), 0)
    if (total > 0 && total - pagoP <= 0.009) fecharConta(id)
  }

  // VENDA DE BALCÃO (venda rápida): "pediu, pagou e levou". Não abre comanda com
  // nome — cria uma comanda já FECHADA na hora com os itens. Assim o estoque baixa
  // e o relatório conta, exatamente como qualquer venda, sem trabalho extra.
  async function venderBalcao(itens, forma = null) {
    if (!itens?.length) return
    // MAQUININHA antes de criar a venda: recusou, nada é gravado e o carrinho
    // continua montado na tela pro freguês tentar outro cartão.
    // mesma conta do carrinho na tela (VendaBalcao), pra cobrar exatamente o
    // que o freguês está vendo
    const totalCarrinho = itens.reduce((s, it) => s + Number(it.cerveja.preco) * it.qtd, 0)
    if (!(await cobrarSePreciso(forma, totalCarrinho))) return

    const nome = 'Balcão ' + hora(Date.now())
    const pago_em = new Date().toISOString()
    // tenta gravar a forma; se a coluna ainda não existe no banco, vende sem ela
    // (a venda nunca trava por causa de um SQL que ainda não rodou)
    let ins = await supabase
      .from('clientes')
      .insert({ nome, aberto: false, pago_em, forma_pagamento: forma })
      .select()
      .single()
    if (ins.error && /forma_pagamento/i.test(ins.error.message || '')) {
      ins = await supabase.from('clientes').insert({ nome, aberto: false, pago_em }).select().single()
    }
    const cli = ins.data
    if (ins.error || !cli) {
      erro('⚠️ Não consegui registrar a venda. Sem conexão?')
      return
    }
    const linhas = itens.map((it) => ({
      cliente_id: cli.id,
      beer_nome: it.cerveja.tamanho ? `${it.cerveja.nome} ${it.cerveja.tamanho}` : it.cerveja.nome,
      preco_unit: it.cerveja.preco,
      quantidade: it.qtd,
    }))
    const { data: cons, error: errIt } = await supabase.from('consumos').insert(linhas).select()
    // se os itens não gravarem, sobra uma venda fechada e VAZIA: o dinheiro
    // entrou mas o relatório mostraria R$ 0,00 e o estoque não baixaria.
    // Melhor desfazer a venda inteira e mandar refazer.
    if (errIt || !cons?.length) {
      await supabase.from('clientes').delete().eq('id', cli.id)
      erro('⚠️ A venda não foi registrada. Refaça — nada foi cobrado no sistema.')
      return
    }
    setConsumos((cs) => [...cons, ...cs]) // estoque + relatório na hora
    setPagas((ps) => [{ ...cli }, ...ps]) // caixa "recebido" reflete na hora
    const total = linhas.reduce((s, r) => s + Number(r.preco_unit) * r.quantidade, 0)
    setBalcaoAberto(false)
    registrar(
      'venda_balcao',
      `Venda de balcão (${money(total)}${forma ? ' · ' + rotuloForma(forma) : ''})`,
      { cliente: cli }
    )
    mostrarToast('Venda de balcão registrada ✓', { tipo: 'ok' })
  }

  // CONTA DIVIDIDA: registra o quanto um amigo pagou (por garrafa ou por valor).
  // A mesa continua aberta mostrando "Falta pagar" até quitar tudo.
  async function pagarParte(cliente_id, valor, qtd = null, itens = null, forma = null) {
    const v = Number(valor) || 0
    if (v <= 0) return
    // MAQUININHA antes de registrar: a parte do amigo que passou cartão só
    // entra na conta depois de aprovada. Recusou, a mesa continua devendo o
    // mesmo tanto e ele tenta outro cartão.
    if (!(await cobrarSePreciso(forma, v))) return
    // guarda QUAIS garrafas foram pagas (no obs, em JSON) — assim a garrafa já paga
    // some da lista de "escolher garrafas" e o verde/vermelho do movimento bate.
    const obs = itens && itens.length ? JSON.stringify(itens) : null
    const linha = { cliente_id, valor: v, qtd, obs }
    // cada parte guarda a SUA forma: um amigo paga em dinheiro, outro no pix, e
    // o caixa continua batendo. Se a coluna ainda não existe, recebe sem ela.
    let ins = await supabase.from('pagamentos_parciais').insert({ ...linha, forma }).select().single()
    if (ins.error && /forma/i.test(ins.error.message || '')) {
      ins = await supabase.from('pagamentos_parciais').insert(linha).select().single()
    }
    const data = ins.data
    if (ins.error || !data) {
      erro('⚠️ Ative a conta dividida: rode o SQL "conta-dividida" no Supabase.')
      return
    }
    setParciais((ps) => [data, ...ps])
    const cli = clientes.find((c) => c.id === cliente_id)
    registrar(
      'pagar_parte',
      `Pagou parte: ${money(v)}${forma ? ' · ' + rotuloForma(forma) : ''}${cli ? ' — ' + cli.nome : ''}`,
      { parcial: data }
    )
    mostrarToast(`Recebido ${money(v)} ✓`, { tipo: 'ok' })
  }

  // ==================== TURNO DE CAIXA (abrir / fechar o dia) ==================
  const caixaAberto = caixaAbertoDe(caixas)
  const diaAtual = diaAtualDoBar(caixas, virada)
  // caixa que ficou aberto de uma noite anterior — ele esqueceu de fechar.
  // Os números daquela noite JÁ estão certos (o relatório corta na virada);
  // isto aqui é só o lembrete pra ele fechar e conferir a gaveta.
  const caixaAtrasado = caixaAberto && String(caixaAberto.dia) !== diaAtual ? caixaAberto : null

  async function abrirCaixa(fundo) {
    const dia = diaAtualDoBar(caixas, virada)
    const ins = await supabase
      .from('caixas')
      .insert({ dia, aberto_em: new Date().toISOString(), fundo_troco: Number(fundo) || 0 })
      .select()
      .single()
    if (ins.error || !ins.data) {
      const msg = ins.error?.message || ''
      // a trava do banco (um caixa aberto por vez) recusa o segundo celular que
      // tocar "abrir" junto. Não é erro de verdade: é só usar o que já abriu.
      if (/duplicate|unique|uq_caixa_aberto/i.test(msg)) {
        await carregar()
        mostrarToast('O caixa já estava aberto ✓', { tipo: 'ok' })
        return true
      }
      erro(
        /caixas/i.test(msg) && /exist|schema|relation/i.test(msg)
          ? '⚠️ Falta rodar o SQL "caixa-turno" no Supabase.'
          : '⚠️ Não consegui abrir o caixa. Sem conexão?'
      )
      return false
    }
    setCaixas((cs) => [ins.data, ...cs])
    registrar('abrir_caixa', `Abriu o caixa de ${diaBonito(dia)} (troco ${money(fundo)})`, {
      caixa: ins.data,
    })
    mostrarToast(`Caixa de ${diaBonito(dia)} aberto ✓`, { tipo: 'ok' })
    return true
  }

  async function fecharCaixa(cx, contado = null) {
    if (!cx) return false
    // Se ele só foi lembrar de fechar depois da virada, o fechamento entra NA
    // VIRADA — que é onde o relatório já tinha cortado a noite. Assim, fechar
    // atrasado não mexe em número nenhum: o que veio depois já é do dia seguinte.
    const limite = viradaDe(somaDia(String(cx.dia), 1), virada)
    const fechado_em = new Date(Math.min(Date.now(), limite)).toISOString()
    const campos = { fechado_em }
    if (contado != null && contado !== '') campos.contado = Number(contado)
    // se a coluna `contado` ainda não existe no banco, fecha sem ela — o
    // fechamento do dia nunca trava por causa de um SQL que não rodou
    let upd = await supabase.from('caixas').update(campos).eq('id', cx.id).select().single()
    if (upd.error && /contado/i.test(upd.error.message || '')) {
      upd = await supabase.from('caixas').update({ fechado_em }).eq('id', cx.id).select().single()
    }
    if (upd.error) {
      erro('⚠️ Não consegui fechar o caixa. Sem conexão? Tente de novo.')
      return false
    }
    setCaixas((cs) => cs.map((c) => (c.id === cx.id ? upd.data || { ...c, ...campos } : c)))
    registrar('fechar_caixa', `Fechou o caixa de ${diaBonito(cx.dia)}`, { caixa: cx })
    mostrarToast(`Caixa de ${diaBonito(cx.dia)} fechado ✓`, { tipo: 'ok' })
    return true
  }

  // NENHUMA VENDA FORA DO CAIXA.
  //
  // Antes existia um "agora não — só lançar": a folha saía do caminho e a venda
  // acontecia com o caixa fechado. O problema é que aquela venda não tinha
  // gaveta pra bater com ela — nem troco declarado, nem contagem no fim. O dono
  // cortou a saída: "todas as vendas têm que ser dentro de caixa aberto e
  // fechado, porque a movimentação tem que bater".
  //
  // Agora o convite não tem porta lateral: ou abre o caixa, ou a venda não
  // acontece. Cancelar fecha a folha e a ação NÃO roda.
  //
  // Única exceção: loja cujo banco ainda não tem a tabela `caixas` (o SQL
  // `caixa-turno` não rodou). Não dá pra exigir um caixa que o banco não sabe
  // guardar — aí segue direto, como antes.
  function comCaixa(acao) {
    if (!temCaixas) {
      acao()
      return
    }
    // Caixa de uma noite ANTERIOR esquecido aberto. Ele conta como "aberto",
    // mas é da noite passada: a de hoje continuaria sem troco declarado e sem
    // contagem no fim — o mesmo furo de vender fora do caixa. E o banco só
    // deixa um caixa aberto por vez, então não dá pra abrir o de hoje por cima.
    // Fecha aquele primeiro; ao terminar, emenda na abertura do de hoje.
    if (caixaAtrasado) {
      setCaixaSheet({ modo: 'fechar', caixa: caixaAtrasado, aoContinuar: acao })
      return
    }
    if (caixaAberto) {
      acao()
      return
    }
    setCaixaSheet({ modo: 'abrir', dia: diaAtual, aoContinuar: acao })
  }

  const resumoTurno = (dia) =>
    resumoDoTurno({
      dia,
      caixas,
      virada,
      consumos,
      pagas,
      abertas: clientes,
      parciais,
    })

  if (!isConfigured) return <Aviso />
  if (carregando) return <div className="centro">Carregando…</div>

  const clienteAberto = clientes.find((c) => c.id === abertoId)
  // Comanda que atravessou a noite: é a única em que faz sentido oferecer o
  // lançamento retroativo (ver `fecharConta`). Comanda de hoje não tem noite
  // passada pra corrigir, então lá o botão nem aparece.
  const noiteDoAberto = clienteAberto ? diaDoBar(clienteAberto.created_at, virada) : null
  const noiteAntiga = noiteDoAberto && noiteDoAberto !== diaAtual ? noiteDoAberto : null

  return (
    <div className="app">
      <header className="topo">
        <div className="marca">
          <span className="marca-logo">🍻</span>
          <div className="marca-txt">
            <h1>{distribuidora?.nome || 'BREJA & CIA'}</h1>
            <span className="marca-sub">Controle de Comandas</span>
          </div>
          {onSair && (
            <button className="btn-sair" onClick={onSair} aria-label="Sair">
              Sair
            </button>
          )}
        </div>
        <nav className="abas">
          <button
            className={aba === 'comandas' ? 'aba on' : 'aba'}
            onClick={() => setAba('comandas')}
          >
            Comandas
          </button>
          {!temEstoque && (
            <button
              className={aba === 'cervejas' ? 'aba on' : 'aba'}
              onClick={() => setAba('cervejas')}
            >
              Produtos
            </button>
          )}
          <button
            className={aba === 'historico' ? 'aba on' : 'aba'}
            onClick={() => setAba('historico')}
          >
            Histórico
          </button>
          {abasExtra.map((k) => (
            <button
              key={k}
              className={aba === k ? 'aba on' : 'aba'}
              onClick={() => setAba(k)}
            >
              {MODULOS[k].label}
            </button>
          ))}
        </nav>
      </header>

      {aba === 'comandas' && (
        <main className="conteudo">
          {temCaixas && (
            <BarraCaixa
              caixaAberto={caixaAberto}
              caixaAtrasado={caixaAtrasado}
              diaAtual={diaAtual}
              onAbrir={() => setCaixaSheet({ modo: 'abrir', dia: diaAtual })}
              onFechar={() => setCaixaSheet({ modo: 'fechar', caixa: caixaAberto })}
            />
          )}

          <div className="add-pessoa">
            <input
              className="campo"
              placeholder={modoMesa ? 'Nº da mesa (ex: 3)' : 'Nome da pessoa'}
              inputMode={modoMesa ? 'numeric' : 'text'}
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && comCaixa(adicionarPessoa)}
            />
            <button className="btn-grande" onClick={() => comCaixa(adicionarPessoa)}>
              {modoMesa ? '+ Mesa' : '+ Nova'}
            </button>
          </div>

          {cervejas.length > 0 && (
            <button
              className="btn-balcao"
              onClick={() => comCaixa(() => setBalcaoAberto(true))}
            >
              ⚡ Venda rápida <span className="bb-sub">— pediu, pagou e levou</span>
            </button>
          )}

          {clientes.length > 3 && (
            <div className="busca-wrap">
              <input
                className="campo busca"
                placeholder={modoMesa ? '🔎 Procurar mesa…' : '🔎 Procurar nome…'}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {busca && (
                <button
                  className="busca-x"
                  onClick={() => setBusca('')}
                  aria-label="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {clientesFiltrados.length === 0 && (
            <p className="vazio">
              {modoMesa
                ? 'Nenhuma mesa aberta. Abra uma mesa acima.'
                : 'Nenhuma comanda aberta. Adicione uma pessoa acima.'}
            </p>
          )}

          <div className="lista">
            {clientesFiltrados.map((c) => {
              const r = resumo[c.id] || { total: 0, qtd: 0 }
              // Comanda que atravessou a noite (o freguês que não pagou ontem).
              // Sem isto ela fica no meio das de hoje sem nada a diferenciando —
              // foi assim que a comanda do Ricardo virou surpresa no fechamento.
              const noite = diaDoBar(c.created_at, virada)
              const deOutraNoite = noite !== diaAtual
              return (
                <button
                  key={c.id}
                  className={'card' + (deOutraNoite ? ' card-antiga' : '')}
                  onClick={() => setAbertoId(c.id)}
                >
                  <span className="card-nome">{c.nome}</span>
                  {deOutraNoite && (
                    <span className="card-noite">🌙 da noite de {diaBonito(noite)}</span>
                  )}
                  <span className="card-info">
                    <span className="qtd">{r.qtd} 🍺</span>
                    <span className="total">{money(r.total)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </main>
      )}

      {aba === 'cervejas' && !temEstoque && (
        <AbaCervejas
          cervejas={cervejas}
          setCervejas={setCervejas}
          onErro={erro}
          onLog={registrar}
        />
      )}

      {aba === 'historico' && (
        <AbaHistorico historico={historico} onReverter={reverter} />
      )}

      {abasExtra.includes(aba) &&
        (aba === 'relatorio' ? (
          <Relatorio
            consumos={consumos}
            cervejas={cervejas}
            pagas={pagas}
            abertas={clientes}
            perdas={perdas}
            parciais={parciais}
            caixas={caixas}
            virada={virada}
            temCaixas={temCaixas}
            caixaAberto={caixaAberto}
            caixaAtrasado={caixaAtrasado}
            diaAtual={diaAtual}
            onAbrirCaixa={() => setCaixaSheet({ modo: 'abrir', dia: diaAtual })}
            onFecharCaixa={() => setCaixaSheet({ modo: 'fechar', caixa: caixaAberto })}
          />
        ) : aba === 'estoque' ? (
          <AbaEstoque
            cervejas={cervejas}
            setCervejas={setCervejas}
            entradas={entradas}
            setEntradas={setEntradas}
            consumos={consumos}
            perdas={perdas}
            setPerdas={setPerdas}
            onErro={erro}
            onLog={registrar}
          />
        ) : aba === 'cozinha' ? (
          <AbaCozinha
            cervejas={cervejas}
            setCervejas={setCervejas}
            consumos={consumos}
            setConsumos={setConsumos}
            clientes={clientes}
            virada={virada}
            onErro={erro}
          />
        ) : (
          MODULOS[aba] && <ModuloEmBreve mod={MODULOS[aba]} />
        ))}

      {clienteAberto && (
        <Detalhe
          cliente={clienteAberto}
          loja={distribuidora?.nome || 'Comanda'}
          cervejas={cervejas}
          consumos={consumos.filter((co) => co.cliente_id === clienteAberto.id)}
          resumo={resumo[clienteAberto.id] || { total: 0, qtd: 0 }}
          parciais={parciais.filter((p) => p.cliente_id === clienteAberto.id)}
          estoque={estoquePorId}
          noiteAntiga={noiteAntiga}
          // Lançar numa comanda JÁ ABERTA também é venda, e passava sem checar
          // caixa nenhum: bastava ter uma comanda da noite passada (ou a que
          // ele deixa pronta pro freguês de todo dia) pra vender com o caixa
          // fechado. Aqui é a mesma porta do "+ Nova" e da venda rápida.
          onAdd={(id, c, q) => comCaixa(() => adicionarConsumo(id, c, q))}
          onRemove={removerConsumo}
          onPagarParte={pagarParte}
          onFechar={fecharConta}
          onExcluir={excluirCliente}
          onRenomear={renomearCliente}
          onVoltar={sairDaComanda}
        />
      )}

      {balcaoAberto && (
        <VendaBalcao
          cervejas={cervejas}
          estoque={estoquePorId}
          onVender={venderBalcao}
          onVoltar={() => setBalcaoAberto(false)}
        />
      )}

      {caixaSheet?.modo === 'abrir' && (
        <FolhaAbrirCaixa
          dia={caixaSheet.dia}
          sugestao={ultimoFundo(caixas)}
          comVenda={!!caixaSheet.aoContinuar}
          onAbrir={async (fundo) => {
            const acao = caixaSheet.aoContinuar
            setCaixaSheet(null)
            const ok = await abrirCaixa(fundo)
            if (ok && acao) acao()
          }}
          // cancelar fecha a folha e a venda NÃO acontece: sem caixa, sem venda
          onCancelar={() => setCaixaSheet(null)}
        />
      )}

      {caixaSheet?.modo === 'fechar' && caixaSheet.caixa && (
        <FolhaFecharCaixa
          caixa={caixaSheet.caixa}
          resumo={resumoTurno(String(caixaSheet.caixa.dia))}
          atrasado={!!caixaAtrasado && caixaAtrasado.id === caixaSheet.caixa.id}
          virada={virada}
          onFechar={async (contado) => {
            const cx = caixaSheet.caixa
            const acao = caixaSheet.aoContinuar
            setCaixaSheet(null)
            const ok = await fecharCaixa(cx, contado)
            // veio de uma venda travada pelo caixa atrasado: fechada aquela
            // noite, emenda direto na abertura da de hoje (`diaAtual` não muda
            // ao fechar um caixa de noite passada — ele já era o de hoje)
            if (ok && acao) setCaixaSheet({ modo: 'abrir', dia: diaAtual, aoContinuar: acao })
          }}
          onCancelar={() => setCaixaSheet(null)}
        />
      )}

      {toast && (
        <div className={'toast toast-' + toast.tipo} key={toast.id}>
          <span className="toast-msg">{toast.msg}</span>
          {toast.acao && (
            <button
              className="toast-acao"
              onClick={() => {
                toast.acao.fn()
                setToast(null)
              }}
            >
              {toast.acao.label}
            </button>
          )}
        </div>
      )}

      {/* Versão nova. Tarja fina embaixo, fora do caminho do dedo: o botão de
          atualizar é pequeno e separado de propósito, pra ninguém recarregar a
          tela sem querer no meio de lançar uma comanda. */}
      {temVersaoNova && (
        <div className="versao-nova">
          <span className="versao-nova-txt">✨ Tem uma versão nova do Comanda</span>
          <button className="versao-nova-btn" onClick={aplicarVersaoNova}>
            Atualizar
          </button>
          <button
            className="versao-nova-x"
            onClick={() => setTemVersaoNova(false)}
            aria-label="Agora não"
          >
            ✕
          </button>
        </div>
      )}

      {/* MAQUININHA — SIMULAÇÃO. Não cobra nada, não fala com máquina nenhuma:
          quem decide aprovado/recusado é a pessoa. Existe pra dar pra testar o
          caminho da RECUSA, que é o perigoso e que não dá pra provocar de
          propósito numa máquina de verdade. Some quando o primeiro adaptador
          real entrar. */}
      {maqPedido && (
        <div className="pag-overlay">
          <div className="pag-box maq-box">
            <span className="maq-tarja">SIMULAÇÃO — nenhum valor é cobrado</span>
            <p className="pag-titulo">Passe o cartão na maquininha</p>
            <strong className="pag-total">{money(maqPedido.centavos / 100)}</strong>
            <span className="pag-sub">{rotuloForma(maqPedido.forma)}</span>
            <div className="maq-botoes">
              <button
                className="pag-forma maq-ok"
                onClick={() => {
                  maqPedido.resolver({
                    ok: true,
                    nsu: String(Date.now()).slice(-6),
                    aut: String(Math.floor(Math.random() * 900000) + 100000),
                    bandeira: 'SIMULADO',
                    simulado: true,
                  })
                  setMaqPedido(null)
                }}
              >
                ✓ Aprovar
              </button>
              <button
                className="pag-forma maq-nao"
                onClick={() => {
                  maqPedido.resolver({
                    ok: false,
                    motivo: 'Cartão recusado pela operadora.',
                    simulado: true,
                  })
                  setMaqPedido(null)
                }}
              >
                ✕ Recusar
              </button>
            </div>
            <button
              className="pag-cancelar"
              onClick={() => {
                maqPedido.resolver({
                  ok: false,
                  motivo: 'Cobrança cancelada.',
                  simulado: true,
                })
                setMaqPedido(null)
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {conexaoRuim && (
        <div className="conexao-lock">
          <div className="conexao-box">
            <span className="conexao-ic">🔒</span>
            <h2 className="conexao-tit">Sem conexão</h2>
            <p className="conexao-txt">
              O app travou por segurança até a internet voltar — assim ninguém cobra
              em cima de uma comanda desatualizada.
            </p>
            <div className="conexao-spin" />
            <span className="conexao-status">Aguardando reconectar…</span>
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================================
//  TURNO DE CAIXA — a barra da tela de Comandas e as folhas de abrir/fechar
//  (as regras de qual venda entra em qual noite estão lá em cima, em
//   "O DIA DO BAR". Aqui é só a tela.)
// ============================================================================

// O troco que ele pôs na gaveta na última NOITE — a gaveta começa quase sempre
// com o mesmo valor, então já vem preenchido.
//
// É o fundo do PRIMEIRO turno daquela noite (mesmo motivo de `fundoDaNoite`).
// Pegando o último turno cru, uma reabertura no meio da noite — digitada com 0,
// porque ali ele não repôs troco nenhum — virava a sugestão da noite seguinte:
// ele confirmava sem reparar e a gaveta nascia R$ 150 curta na conferência.
function ultimoFundo(caixas = []) {
  let ultimaNoite = null
  for (const c of caixas) {
    const d = String(c.dia)
    if (!ultimaNoite || d > ultimaNoite) ultimaNoite = d
  }
  return ultimaNoite ? fundoDaNoite(caixas, ultimaNoite) : FUNDO_TROCO
}

// Os números de UMA noite: o que saiu (faturamento) e o que entrou de verdade
// (caixa, por forma). É a mesma conta do Relatório, recortada pela janela
// daquela noite — por isso a folha de fechamento bate com o relatório do dia.
function resumoDoTurno({
  dia,
  caixas = [],
  virada = HORA_VIRADA,
  consumos = [],
  pagas = [],
  abertas = [],
  parciais = [],
}) {
  const { inicio, fim } = janelaDoDia(dia, caixas, virada)
  const totalPorCliente = new Map()
  for (const c of consumos)
    totalPorCliente.set(
      c.cliente_id,
      (totalPorCliente.get(c.cliente_id) || 0) + Number(c.preco_unit) * c.quantidade
    )
  const parcialPorCliente = new Map()
  for (const p of parciais)
    parcialPorCliente.set(
      p.cliente_id,
      (parcialPorCliente.get(p.cliente_id) || 0) + Number(p.valor || 0)
    )

  let faturamento = 0
  let itens = 0
  const comandas = new Set()
  for (const c of consumos) {
    const t = new Date(c.created_at).getTime()
    if (t < inicio || t > fim) continue
    faturamento += Number(c.preco_unit) * c.quantidade
    itens += c.quantidade
    comandas.add(c.cliente_id)
  }
  const caixa = calcularCaixa({
    pagas,
    abertas,
    parciais,
    totalPorCliente,
    parcialPorCliente,
    inicio,
    fim,
  })
  const fundo = fundoDaNoite(caixas, dia)
  return { inicio, fim, faturamento, itens, nComandas: comandas.size, fundo, ...caixa }
}

// Barra do caixa no topo das Comandas: o estado da noite em uma linha.
function BarraCaixa({ caixaAberto, caixaAtrasado, diaAtual, onAbrir, onFechar }) {
  if (caixaAtrasado) {
    return (
      <div className="cx-barra cx-atrasado">
        <div className="cx-txt">
          <span className="cx-tit">
            ⚠️ O caixa de {diaBonito(caixaAtrasado.dia)} ficou aberto
          </span>
          <span className="cx-sub">
            Feche pra conferir a gaveta daquela noite. Os números já estão
            separados certinho — o movimento de agora conta no dia de hoje.
          </span>
        </div>
        <button className="cx-btn cx-btn-alerta" onClick={onFechar}>
          🔒 Fechar o caixa de {diaBonito(caixaAtrasado.dia)}
        </button>
      </div>
    )
  }
  // caixa aberto e em dia: faixa fina, pra não roubar a tela de trabalho
  if (caixaAberto) {
    return (
      <div className="cx-barra cx-ligado cx-compacta">
        <div className="cx-txt">
          <span className="cx-tit">🟢 Caixa aberto · {diaBonito(caixaAberto.dia)}</span>
          <span className="cx-sub">desde as {hora(caixaAberto.aberto_em)}</span>
        </div>
        <button className="cx-btn" onClick={onFechar}>
          🔒 Fechar caixa
        </button>
      </div>
    )
  }
  return (
    <div className="cx-barra">
      <div className="cx-txt">
        <span className="cx-tit">🔴 Caixa fechado</span>
        <span className="cx-sub">Abra o caixa pra começar a noite de {diaBonito(diaAtual)}</span>
      </div>
      <button className="cx-btn cx-btn-abrir" onClick={onAbrir}>
        ▶ Abrir o caixa de {diaBonito(diaAtual)}
      </button>
    </div>
  )
}

// Folha de ABRIR o caixa. Aparece sozinha na primeira venda da noite — e, desde
// que a saída "agora não" caiu, ela é obrigatória: sem caixa aberto não vende
// (ver `comCaixa`). Cancelar aqui cancela a venda, não a folha.
function FolhaAbrirCaixa({ dia, sugestao, comVenda, onAbrir, onCancelar }) {
  const [fundo, setFundo] = useState(() => String(sugestao ?? FUNDO_TROCO))
  const [indo, setIndo] = useState(false)
  const valor = Number(String(fundo).replace(',', '.')) || 0
  return (
    <div className="pag-overlay" onClick={onCancelar}>
      <div className="pag-box" onClick={(e) => e.stopPropagation()}>
        <p className="pag-titulo">Vamos abrir o caixa de {diaBonito(dia)}?</p>
        {comVenda && (
          <p className="cx-folha-aviso">
            Pra vender, o caixa precisa estar aberto — é ele que faz a
            movimentação da noite bater com a gaveta.
          </p>
        )}
        <p className="cx-folha-txt">
          Daqui até você tocar em <b>Fechar caixa</b>, tudo que vender entra na
          noite de <b>{diaBonito(dia)}</b> — mesmo depois da meia-noite.
        </p>

        <span className="cx-folha-lbl">Quanto tem de troco na gaveta?</span>
        <div className="cx-fundo">
          <span className="cx-fundo-cifrao">R$</span>
          <input
            className="cx-fundo-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="10"
            value={fundo}
            onChange={(e) => setFundo(e.target.value)}
          />
        </div>
        <span className="caixa-sub">
          É esse valor que o app usa pra dizer quanto tem que ter na gaveta no fim
          da noite.
        </span>

        <button
          className="pag-confirmar"
          disabled={indo}
          onClick={() => {
            setIndo(true)
            onAbrir(valor)
          }}
        >
          {indo ? 'Abrindo…' : `▶ Abrir o caixa de ${diaBonito(dia)}`}
        </button>
        <button className="pag-cancelar" onClick={onCancelar}>
          {comVenda ? 'Cancelar — não vou vender agora' : 'Agora não'}
        </button>
      </div>
    </div>
  )
}

// Folha de FECHAR o caixa: mostra o fechamento da noite e confere a gaveta.
function FolhaFecharCaixa({ caixa, resumo, atrasado, virada = HORA_VIRADA, onFechar, onCancelar }) {
  const [contado, setContado] = useState('')
  const [indo, setIndo] = useState(false)
  // trava de comanda aberta: quando ainda tem gente devendo, o fechamento passa
  // por uma parada obrigatória antes de acontecer (ver o alerta lá embaixo)
  const [alertaAberto, setAlertaAberto] = useState(false)
  const esperado = resumo.fundo + resumo.dinheiro
  const temContagem = String(contado).trim() !== ''
  const diferenca = temContagem ? (Number(String(contado).replace(',', '.')) || 0) - esperado : 0
  const devendo = resumo.devendo || []

  // Comanda VAZIA (a que ele deixa pronta pro freguês de todo dia) não conta:
  // ela não é dívida, e travar o fechamento por causa dela seria um alarme que
  // toca toda noite — em uma semana ninguém mais lê.
  const temDevendo = resumo.emAberto > 0.009

  function confirmar() {
    setIndo(true)
    onFechar(temContagem ? Number(String(contado).replace(',', '.')) || 0 : null)
  }
  return (
    <div className="pag-overlay" onClick={onCancelar}>
      <div className="pag-box cx-fechar-box" onClick={(e) => e.stopPropagation()}>
        <p className="pag-titulo">🧾 Fechar o caixa de {diaBonito(caixa.dia)}</p>
        <span className="cx-janela">
          das {hora(resumo.inicio)} às {hora(resumo.fim)}
          {atrasado ? '' : ' (agora)'}
        </span>

        {atrasado && (
          <p className="cx-folha-aviso">
            Esta noite já passou. Vou fechar com o movimento até as{' '}
            {String(virada).padStart(2, '0')}:00 — o que veio depois já está
            contando no dia seguinte, nada muda de lugar.
          </p>
        )}

        <div className="cx-linhas">
          <div className="cf-linha">
            <span>Faturamento (saiu)</span>
            <b>{money(resumo.faturamento)}</b>
          </div>
          <div className="cf-linha">
            <span>Recebido (entrou)</span>
            <b>{money(resumo.recebido)}</b>
          </div>
          {resumo.formas.map((f) => (
            <div key={f.id || 'outro'} className="cf-linha cf-fina">
              <span>{rotuloForma(f.id)}</span>
              <b>{money(f.valor)}</b>
            </div>
          ))}
          {resumo.emAberto > 0.009 && (
            <div className="cf-linha cf-aberto">
              <span>Fica em aberto ({resumo.nAberto})</span>
              <b>{money(resumo.emAberto)}</b>
            </div>
          )}
        </div>

        <div className="cx-gaveta">
          <span className="kpi-lbl">💵 Tem que ter na gaveta</span>
          <strong className="kpi-val">{money(esperado)}</strong>
          <span className="caixa-sub">
            troco {money(resumo.fundo)} + vendas em dinheiro {money(resumo.dinheiro)}
          </span>
          <div className="cx-fundo">
            <span className="cx-fundo-cifrao">R$</span>
            <input
              className="cx-fundo-input"
              type="number"
              inputMode="decimal"
              placeholder="contei…"
              value={contado}
              onChange={(e) => setContado(e.target.value)}
            />
          </div>
          {temContagem && (
            <span
              className={
                Math.abs(diferenca) < 0.01
                  ? 'cx-dif cx-dif-ok'
                  : diferenca > 0
                    ? 'cx-dif cx-dif-sobra'
                    : 'cx-dif cx-dif-falta'
              }
            >
              {Math.abs(diferenca) < 0.01
                ? '✓ Bateu certinho'
                : diferenca > 0
                  ? `Sobrando ${money(diferenca)} na gaveta`
                  : `Faltando ${money(-diferenca)} na gaveta`}
            </span>
          )}
        </div>

        {temDevendo && (
          <p className="cx-folha-txt">
            As comandas que ficarem abertas continuam abertas — quando forem pagas,
            o dinheiro entra no caixa do dia em que você receber.
          </p>
        )}

        <button
          className="pag-confirmar"
          disabled={indo}
          onClick={() => {
            // ainda tem gente devendo? o fechamento para aqui e pede uma
            // decisão consciente antes de seguir
            if (temDevendo) {
              setAlertaAberto(true)
              return
            }
            confirmar()
          }}
        >
          {indo ? 'Fechando…' : '🔒 Confirmar fechamento'}
        </button>
        <button className="pag-cancelar" onClick={onCancelar}>
          Ainda não
        </button>
      </div>

      {/* TRAVA: fechar o caixa com comanda em aberto.
          Não é bloqueio total de propósito — fiado existe, e o freguês que
          "paga amanhã" não pode impedir o bar de fechar a noite. O que ela
          precisa é VER quem ficou devendo antes de decidir, em vez de
          descobrir depois que o caixa já foi. */}
      {alertaAberto && (
        <div className="excesso-overlay" onClick={() => setAlertaAberto(false)}>
          <div className="excesso-box" onClick={(e) => e.stopPropagation()}>
            <span className="excesso-ic">⚠️</span>
            <p className="excesso-tit">
              {devendo.length === 1
                ? 'Ainda tem 1 comanda aberta!'
                : `Ainda têm ${devendo.length} comandas abertas!`}
            </p>
            <p className="excesso-txt">
              Falta receber <b>{money(resumo.emAberto)}</b>. Se fechar o caixa agora,
              esse dinheiro <b>não entra na noite de {diaBonito(caixa.dia)}</b> — ele vai
              entrar no dia em que você receber.
            </p>
            <div className="cx-devendo">
              {devendo.map((c) => (
                <div key={c.id} className="cf-linha">
                  <span>{c.nome}</span>
                  <b>{money(c.total)}</b>
                </div>
              ))}
            </div>
            <button
              className="excesso-ok"
              onClick={() => {
                setAlertaAberto(false)
                confirmar()
              }}
            >
              Fechar assim mesmo
            </button>
            <button className="excesso-voltar" onClick={() => setAlertaAberto(false)}>
              ‹ Voltar e receber agora
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// marcas populares no Brasil — pra autocompletar e corrigir digitação
const MARCAS_POPULARES = [
  // cervejas
  'Skol', 'Brahma', 'Brahma Duplo Malte', 'Antarctica', 'Original', 'Bohemia',
  'Heineken', 'Amstel', 'Budweiser', 'Stella Artois', 'Spaten', 'Eisenbahn',
  'Itaipava', 'Petra', 'Devassa', 'Kaiser', 'Schin', 'Nova Schin', 'Serramalte',
  'Bavária', 'Corona', 'Becks', 'Patagonia', 'Império', 'Colorado', 'Praya',
  'Sol', 'Caracu', 'Polar', 'Therezópolis', 'Baden Baden', 'Lokal',
  // refrigerantes
  'Coca-Cola', 'Coca-Cola Zero', 'Guaraná Antarctica', 'Fanta', 'Fanta Laranja',
  'Fanta Uva', 'Sprite', 'Pepsi', 'Kuat', 'Schweppes', 'Dolly', 'Sukita',
  'H2OH', 'Soda', 'Tubaína',
  // energéticos
  'Red Bull', 'Monster', 'TNT', 'Fusion', 'Baly', 'Red Horse', 'Burn',
  // água
  'Água', 'Bonafont', 'Indaiá', 'Minalba', 'Crystal',
  // ice / outros de distribuidora
  'Smirnoff Ice', 'Skol Beats', '51 Ice', 'Ypióca', '51', 'Velho Barreiro',
]

const normalizar = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// distância de edição (Levenshtein) — mede quão "perto" duas palavras estão
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prev = tmp
    }
  }
  return dp[n]
}

// sugere nomes de uma lista: autocomplete (começa/contém) ou correção (perto)
function sugerir(texto, lista) {
  const qn = normalizar(texto)
  if (qn.length < 2) return null
  if (lista.some((m) => normalizar(m) === qn)) return null // já exato
  const scored = []
  for (const m of lista) {
    const mn = normalizar(m)
    let score
    let tipo
    if (mn.startsWith(qn)) {
      score = 0
      tipo = 'auto'
    } else if (mn.includes(qn)) {
      score = 1
      tipo = 'auto'
    } else {
      const d = levenshtein(qn, mn)
      if (d <= 2 && Math.abs(mn.length - qn.length) <= 3) {
        score = 2 + d
        tipo = 'correcao'
      } else continue
    }
    scored.push({ m, score, tipo })
  }
  if (!scored.length) return null
  scored.sort((a, b) => a.score - b.score)
  const top = scored.slice(0, 5)
  return { nomes: top.map((s) => s.m), correcao: top.every((s) => s.tipo === 'correcao') }
}

const sugerirMarcas = (texto) => sugerir(texto, MARCAS_POPULARES)

// como o produto se chama por extenso, e se ele casa com o que foi digitado
const reprProduto = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)
const casaProduto = (c, termo) =>
  normalizar(c.nome).includes(termo) || normalizar(reprProduto(c)).includes(termo)

// ===========================================================================
//  Navegação pasta → sub-pasta → produtos, com busca em qualquer nível.
//  É a MESMA na comanda e na venda rápida; o que muda é só o card do produto.
//
//  A busca mora no pai (`busca`/`setBusca`) porque ele precisa limpá-la depois
//  de lançar. Trocar de nível também limpa: voltar de uma pasta carregando o
//  termo velho só confunde.
// ===========================================================================
function PastasDeProdutos({ produtos, busca, setBusca, renderCard, badge, vazio, semResultado }) {
  const [pasta, setPasta] = useState(null)
  const [sub, setSub] = useState(null)

  const pastas = useMemo(() => agruparEmPastas(produtos), [produtos])
  const pastaFoco = pasta ? pastas.find((p) => p.label === pasta) : null
  const { subs, soltos } = useMemo(
    () => (pastaFoco ? dividirEmSubPastas(pastaFoco.itens) : { subs: [], soltos: [] }),
    [pastaFoco]
  )
  const subFoco = sub ? subs.find((s) => s.label === sub) : null
  const foco = subFoco || pastaFoco

  // a busca varre o nível em que você está: na raiz procura em tudo, dentro de
  // uma pasta procura só nela (inclusive no que está nas sub-pastas dela)
  const escopo = subFoco ? subFoco.itens : pastaFoco ? pastaFoco.itens : produtos
  const q = normalizar(busca)
  const achados = q ? escopo.filter((c) => casaProduto(c, q)) : null

  const abrirPasta = (label) => {
    setPasta(label)
    setSub(null)
    setBusca('')
  }
  const abrirSub = (label) => {
    setSub(label)
    setBusca('')
  }
  const voltar = () => {
    if (subFoco) setSub(null)
    else {
      setPasta(null)
      setSub(null)
    }
    setBusca('')
  }

  const conta = (n) => `${n} produto${n === 1 ? '' : 's'}`
  const cartaoPasta = (p, onClick, sufixo) => {
    const marca = badge ? badge(p.itens) : null
    return (
      <button key={p.label} className="est-folder" onClick={onClick}>
        <span className="est-folder-ic">{p.icone}</span>
        <div className="est-folder-txt">
          <span className="est-folder-nome">{p.label}</span>
          <span className="est-folder-sub">{sufixo}</span>
        </div>
        {marca && <span className="pasta-cart">{marca}</span>}
        <span className="est-folder-seta">›</span>
      </button>
    )
  }

  return (
    <>
      {foco && (
        <div className="est-nav prod-nav">
          <button className="est-voltar" onClick={voltar}>
            ‹ Voltar
          </button>
          <span className="est-nav-tit">
            {foco.icone} {foco.label}
          </span>
        </div>
      )}

      {produtos.length > 0 && (
        <div className="busca-wrap busca-prod">
          <input
            className="campo busca"
            placeholder={foco ? `🔎 Buscar em ${foco.label}…` : '🔎 Procurar produto…'}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <button className="busca-x" onClick={() => setBusca('')} aria-label="Limpar busca">
              ✕
            </button>
          )}
        </div>
      )}

      <div className="lista-prod">
        {produtos.length === 0 ? (
          vazio
        ) : achados ? (
          achados.length > 0 ? (
            achados.map(renderCard)
          ) : (
            semResultado(busca, setBusca)
          )
        ) : subFoco ? (
          subFoco.itens.map(renderCard)
        ) : pastaFoco ? (
          <>
            {subs.length > 0 && (
              <div className="est-folders">
                {subs.map((s) => cartaoPasta(s, () => abrirSub(s.label), conta(s.itens.length)))}
              </div>
            )}
            {soltos.map(renderCard)}
          </>
        ) : (
          <div className="est-folders">
            {pastas.map((p) => {
              const d = dividirEmSubPastas(p.itens)
              return cartaoPasta(
                p,
                () => abrirPasta(p.label),
                d.subs.length > 0
                  ? `${d.subs.length} pastas · ${conta(p.itens.length)}`
                  : conta(p.itens.length)
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// CONTA DIVIDIDA: quais garrafas da mesa já foram pagas e quais faltam.
// Fica aqui fora, pura, porque é a terceira conta que TEM que fechar — é o
// que o freguês vê quando pergunta "o que falta do meu?".
//
// Pagamento POR GARRAFA guarda QUAIS garrafas (JSON no campo obs), então
// marca exatamente aquelas. Pagamento POR VALOR não sabe qual garrafa: cobre
// as mais baratas primeiro, pra o vermelho da tela nunca prometer menos
// dívida do que existe.
function calcularGarrafas(consumos, parciais) {
    const itensDoPagto = (p) => {
      if (Array.isArray(p.itens)) return p.itens
      if (p.obs) {
        try {
          const x = JSON.parse(p.obs)
          return Array.isArray(x) ? x : null
        } catch (_) {
          return null
        }
      }
      return null
    }
    const uni = []
    for (const co of consumos)
      for (let k = 0; k < co.quantidade; k++)
        uni.push({ nome: co.beer_nome, preco: Number(co.preco_unit), t: co.created_at, pago: false })
    uni.sort((a, b) => new Date(a.t) - new Date(b.t))

    // 1) pagamentos por garrafa marcam produtos específicos
    const pagoItens = new Map()
    let valorGenerico = 0
    for (const p of parciais) {
      const its = itensDoPagto(p)
      if (its && its.length) {
        for (const it of its)
          pagoItens.set(it.nome, (pagoItens.get(it.nome) || 0) + Number(it.qtd || 0))
      } else {
        valorGenerico += Number(p.valor || 0)
      }
    }
    for (const [nome, q] of pagoItens) {
      let restam = q
      for (const u of uni) {
        if (restam <= 0) break
        if (u.nome === nome && !u.pago) {
          u.pago = true
          restam -= 1
        }
      }
    }
    // 2) pagamentos por valor cobrem o restante (mais barato primeiro)
    let acc = 0
    for (const u of uni.filter((x) => !x.pago).sort((a, b) => a.preco - b.preco)) {
      if (acc + u.preco <= valorGenerico + 0.001) {
        u.pago = true
        acc += u.preco
      }
    }

    const agrupar = (lista) => {
      const m = new Map()
      for (const u of lista) {
        if (!m.has(u.nome)) m.set(u.nome, { nome: u.nome, qtd: 0, total: 0, preco: u.preco })
        const g = m.get(u.nome)
        g.qtd += 1
        g.total += u.preco
      }
      return [...m.values()].sort((a, b) => b.qtd - a.qtd)
    }
    const pagas = uni.filter((u) => u.pago)
    const pend = uni.filter((u) => !u.pago)
    return {
      nPagas: pagas.length,
      nFalta: pend.length,
      pagasGrp: agrupar(pagas),
      pendentesGrp: agrupar(pend),
    }
}

function Detalhe({ cliente, loja = 'Comanda', cervejas, consumos, resumo, parciais = [], estoque = new Map(), noiteAntiga = null, onAdd, onRemove, onPagarParte, onFechar, onExcluir, onRenomear, onVoltar }) {
  const [qtd, setQtd] = useState(1)
  const [editNome, setEditNome] = useState(false) // editando o nome da comanda
  const [nomeEdit, setNomeEdit] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [ultimoTocado, setUltimoTocado] = useState(null) // só p/ a animação
  const [mostrarResumo, setMostrarResumo] = useState(false)
  const [confirmar, setConfirmar] = useState(null) // produto aguardando confirmação
  const [confPagto, setConfPagto] = useState(false) // confirmação de pagamento ao fechar
  const [parteAberto, setParteAberto] = useState(false) // modal "pagar parte" (conta dividida)
  const [verPagos, setVerPagos] = useState(false) // modal com o movimento dos pagamentos parciais
  const [excesso, setExcesso] = useState(null) // pagamento que passou do que falta, aguardando confirmação
  const [confGarrafa, setConfGarrafa] = useState(null) // confirmação ao passar do que tem na mesa
  const [modoParte, setModoParte] = useState('garrafa') // 'garrafa' | 'valor'
  const [selGarrafas, setSelGarrafas] = useState({}) // {beer_nome: qtd escolhida}
  const [valorParte, setValorParte] = useState('')
  const [formaParte, setFormaParte] = useState('dinheiro') // como ESSE amigo pagou
  const [retro, setRetro] = useState(false) // pagamento entrou na noite passada, não agora
  const [pessoas, setPessoas] = useState(0) // dividir a conta entre N pessoas (modo valor)
  const [dividirN, setDividirN] = useState(1) // calculadora "dividir" na tela da mesa
  const [impressoEm, setImpressoEm] = useState(null) // hora carimbada no cupom

  const reprDe = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

  function tocar(c) {
    onAdd(cliente.id, c, qtd)
    setQtd(1)
    setBuscaProd('') // ao selecionar, limpa a busca (a pasta continua aberta:
    setUltimoTocado(c.id) // costuma vir outra rodada dali)
  }

  // ordem dos produtos: o último consumido fica no topo. Vem do histórico salvo,
  // então persiste mesmo saindo e voltando na comanda.
  const ordenados = useMemo(() => {
    const recencia = new Map() // beer_nome -> created_at mais recente
    for (const co of consumos) {
      if (!recencia.has(co.beer_nome)) recencia.set(co.beer_nome, co.created_at)
    }
    return [...cervejas].sort((a, b) => {
      const ra = recencia.get(a.tamanho ? `${a.nome} ${a.tamanho}` : a.nome)
      const rb = recencia.get(b.tamanho ? `${b.nome} ${b.tamanho}` : b.nome)
      if (ra && rb) return ra < rb ? 1 : ra > rb ? -1 : 0
      if (ra) return -1
      if (rb) return 1
      return (a.ordem ?? 0) - (b.ordem ?? 0)
    })
  }, [cervejas, consumos])

  // se a busca não achou nada, tenta corrigir pelo nome dos produtos cadastrados
  const nomesProdutos = useMemo(
    () => [...new Set(cervejas.map((c) => c.nome))],
    [cervejas]
  )

  // resumo de fechamento: agrupa o consumo por produto (qtd total e valor total)
  const resumoItens = useMemo(() => {
    const map = new Map()
    for (const co of consumos) {
      if (!map.has(co.beer_nome))
        map.set(co.beer_nome, { nome: co.beer_nome, qtd: 0, total: 0 })
      const it = map.get(co.beer_nome)
      it.qtd += co.quantidade
      it.total += Number(co.preco_unit) * co.quantidade
    }
    return [...map.values()].sort((a, b) => b.qtd - a.qtd)
  }, [consumos])

  // conta dividida: quanto já pagaram e quanto falta
  const pago = parciais.reduce((s, p) => s + Number(p.valor || 0), 0)
  const falta = Math.max(0, resumo.total - pago)
  const temParcial = pago > 0.009
  const quitado = temParcial && resumo.total > 0 && falta <= 0.009 // pago por completo via parciais

  // garrafas pagas x faltando. Pagamento POR GARRAFA guarda QUAIS garrafas (JSON no
  // campo obs) → marca exatamente esses produtos, então a Heineken já paga não volta
  // pra lista. Pagamento POR VALOR não sabe qual garrafa → cobre o restante mais
  // barato primeiro. Assim o vermelho mostra só o que realmente falta pagar.
  // quais garrafas já foram pagas e quais faltam (ver calcularGarrafas)
  const garrafas = useMemo(() => calcularGarrafas(consumos, parciais), [consumos, parciais])
  const garrafasFalta = garrafas.nFalta

  // seleção do "pagar por garrafa" — a lista mostra SÓ o que ainda falta pagar
  const somaGarrafasBruta = garrafas.pendentesGrp.reduce(
    (s, it) => s + (selGarrafas[it.nome] || 0) * it.preco,
    0
  )
  // nunca cobra mais do que falta: se a última garrafa já foi paga em parte (por
  // valor), puxa só o que resta dela — mas dá baixa na garrafa mesmo assim.
  const somaGarrafas = Math.min(somaGarrafasBruta, falta)
  const garrafaResto = somaGarrafasBruta > falta + 0.01 // capou no que falta
  const qtdGarrafas = Object.values(selGarrafas).reduce((s, n) => s + n, 0)
  const valorDigitado = Number(String(valorParte).replace(',', '.')) || 0

  function mudarSel(nome, delta) {
    setSelGarrafas((s) => {
      const novo = Math.max(0, (s[nome] || 0) + delta)
      return { ...s, [nome]: novo }
    })
  }
  // tocar no "+": se for passar do que tem na mesa, pede confirmação antes
  function maisUma(it) {
    const sel = selGarrafas[it.nome] || 0
    if (sel + 1 > it.qtd) {
      setConfGarrafa({ nome: it.nome, qtd: it.qtd, alvo: sel + 1 })
    } else {
      mudarSel(it.nome, +1)
    }
  }
  // divide o que falta entre N pessoas e preenche o valor de cada um
  function escolherPessoas(n) {
    setPessoas(n)
    setValorParte((falta / n).toFixed(2))
  }
  function fecharParte() {
    setParteAberto(false)
    setSelGarrafas({})
    setValorParte('')
    setModoParte('garrafa')
    setFormaParte('dinheiro')
    setPessoas(0)
    setExcesso(null)
  }
  function confirmarParte(valor, qtd, itens = null) {
    if (!(valor > 0)) return
    // arredondamento da divisão pode passar 1 centavo: se está só um tiquinho acima
    // do que falta, trata como o valor exato (quita limpo, sem alarme falso).
    if (valor > falta && valor - falta <= 0.05) valor = falta
    // trava de limite: passou do que ainda falta? pede confirmação antes de cobrar a mais
    if (valor > falta + 0.001) {
      setExcesso({ valor, qtd, itens })
      return
    }
    onPagarParte(cliente.id, valor, qtd, itens, formaParte)
    const zerou = resumo.total - (pago + valor) <= 0.009
    fecharParte()
    if (zerou) setConfPagto(true) // quitou → já oferece encerrar a comanda
  }
  function confirmarExcesso() {
    if (!excesso) return
    onPagarParte(cliente.id, excesso.valor, excesso.qtd, excesso.itens, formaParte)
    fecharParte()
    setConfPagto(true) // recebeu o resto (ou mais) → oferece encerrar
  }
  function salvarNome() {
    const n = nomeEdit.trim()
    if (n && n !== cliente.nome) onRenomear(cliente.id, n)
    setEditNome(false)
  }

  // Imprimir: quem monta o papel é o navegador (window.print). O cupom já está
  // montado aqui do lado, escondido — o CSS de impressão apaga o app e deixa só
  // ele. Assim funciona com qualquer impressora que o celular enxergue, e sem
  // impressora vira "Salvar em PDF".
  // O respiro antes do print é pra o React já ter pintado a hora no cupom.
  function imprimir() {
    setImpressoEm(Date.now())
    setTimeout(() => window.print(), 80)
  }

  // a linha de forma de pagamento aparece igual nos dois modos do "pagar parte"
  const chipsForma = (
    <div className="parte-formas">
      <span className="parte-formas-lbl">Como esse pagou?</span>
      <div className="forma-chips">
        {FORMAS_PAGAMENTO.map((f) => (
          <button
            key={f.id}
            className={'forma-chip' + (formaParte === f.id ? ' on' : '')}
            onClick={() => setFormaParte(f.id)}
          >
            {f.icone} {f.label}
          </button>
        ))}
      </div>
    </div>
  )

  // o mesmo card serve dentro da pasta e no resultado da busca
  const cardProduto = (c) => {
    const cor = corDe(c.nome, c.cor)
    const zerado = semEstoque(estoque.get(c.id))
    return (
      <button
        key={c.id}
        className={'prod-card' + (ultimoTocado === c.id ? ' destaque' : '')}
        style={{ background: cor.bg, color: cor.fg }}
        onClick={() => setConfirmar(c)}
      >
        {c.foto && (
          <img
            className="pc-foto"
            src={c.foto}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span className="pc-nome">{c.nome}</span>
        <span className="pc-info">
          {/* o selo aparece antes do toque: melhor não errar do que desfazer */}
          {zerado && <span className="pc-zerado">⚠️ acabou</span>}
          {c.tamanho && <span className="pc-tam">{c.tamanho}</span>}
          <span className="pc-preco">{money(c.preco)}</span>
        </span>
      </button>
    )
  }

  return (
    <div className="overlay">
      <div className="detalhe">
        <header className="det-topo">
          <div className="det-topo-row">
            <button className="voltar" onClick={onVoltar}>
              ‹ Voltar
            </button>
            <button
              className="excluir-x"
              // quem confirma (e quem barra, se já entrou dinheiro) é o
              // excluirCliente lá em cima, que enxerga vendas e pagamentos
              onClick={() => onExcluir(cliente.id)}
            >
              ✕ Excluir
            </button>
          </div>
          {editNome ? (
            <div className="det-nome-edit">
              <input
                className="det-nome-input"
                value={nomeEdit}
                autoFocus
                placeholder="Nome da comanda"
                onChange={(e) => setNomeEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') salvarNome()
                  if (e.key === 'Escape') setEditNome(false)
                }}
              />
              <button className="det-nome-ok" onClick={salvarNome} aria-label="Salvar nome">
                ✓
              </button>
              <button
                className="det-nome-cancel"
                onClick={() => setEditNome(false)}
                aria-label="Cancelar"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="det-nome">
              <h2>{cliente.nome}</h2>
              <button
                className="det-editar"
                onClick={() => {
                  setNomeEdit(cliente.nome)
                  setEditNome(true)
                }}
                aria-label="Editar nome"
              >
                ✏️
              </button>
            </div>
          )}
        </header>

        <div className="stepper">
          <span>Quantidade:</span>
          <button onClick={() => setQtd((q) => Math.max(1, q - 1))}>−</button>
          <strong>{qtd}</strong>
          <button onClick={() => setQtd((q) => q + 1)}>+</button>
        </div>

        <PastasDeProdutos
          produtos={ordenados}
          busca={buscaProd}
          setBusca={setBuscaProd}
          renderCard={cardProduto}
          vazio={<p className="vazio">Nenhum produto cadastrado. Vá em "Produtos".</p>}
          semResultado={(termo, escolher) => {
            const sug = sugerir(termo, nomesProdutos)
            return sug ? (
              <div className="sug-marca">
                <span className="tam-label">🤔 Você quis dizer?</span>
                <div className="chips">
                  {sug.nomes.map((m) => (
                    <button key={m} className="chip chip-sug" onClick={() => escolher(m)}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="vazio">Nenhum produto encontrado.</p>
            )
          }}
        />

        {/* a lista de lançamentos saiu daqui e foi pro 📋 Resumo — na tela da
            mesa ela empurrava os produtos pra baixo a cada cerveja lançada */}

        <footer className="det-rodape">
          {/* 1ª linha — total à esquerda + calculadora "dividir" à direita */}
          <div className="rodape-linha1">
            <div className="total-grande total-topo">
              <span className="tg-itens">
                {quitado
                  ? 'Tudo pago 🎉'
                  : temParcial
                    ? `Falta pagar${garrafasFalta > 0 ? ` · ≈ ${garrafasFalta} 🍺` : ''}`
                    : `${resumo.qtd} produtos`}
              </span>
              <strong className={temParcial && !quitado ? 'tg-falta' : ''}>
                {money(temParcial && !quitado ? falta : resumo.total)}
              </strong>
            </div>
            {falta > 0 && (
              <div className="mesa-dividir">
                <span className="md-lbl">Dividir entre quantas pessoas?</span>
                <div className="md-ctrl">
                  <div className="md-step">
                    <button onClick={() => setDividirN((n) => Math.max(1, n - 1))} disabled={dividirN <= 1}>
                      −
                    </button>
                    <strong>{dividirN}</strong>
                    <button onClick={() => setDividirN((n) => n + 1)}>+</button>
                  </div>
                  <span className="md-eq">= {money(falta / dividirN)} cada</span>
                </div>
              </div>
            )}
          </div>

          {/* 2º — resumo do que já entrou (o "Falta" está no número grande acima) */}
          {temParcial && (
            <button className="pago-pill" onClick={() => setVerPagos(true)}>
              <span className="pp-txt">
                Total <b className="pp-total">{money(resumo.total)}</b> · já pago{' '}
                <b className="pp-pago">{money(pago)}</b> ✓
              </span>
              <em className="pp-ver">ver movimento ›</em>
            </button>
          )}

          {/* 3º — botões secundários */}
          <div className="rodape-botoes">
            <button className="btn-resumo" onClick={imprimir} disabled={resumo.qtd === 0}>
              🖨️ Imprimir
            </button>
            <button
              className="btn-resumo"
              onClick={() => setMostrarResumo(true)}
              disabled={resumo.qtd === 0}
            >
              📋 Resumo
            </button>
            <button
              className="btn-parte"
              onClick={() => setParteAberto(true)}
              disabled={resumo.qtd === 0 || quitado}
            >
              👥 Pagar parte
            </button>
          </div>

          {/* 4º — ação principal (fechar / receber o resto / encerrar) */}
          <button className="btn-pagar" onClick={() => setConfPagto(true)}>
            {quitado
              ? '✓ Encerrar comanda (tudo pago)'
              : temParcial
                ? `✓ Receber o resto · ${money(falta)}`
                : '✓ Pagar / Fechar'}
          </button>
        </footer>
      </div>

      {mostrarResumo && (
        <div className="resumo-overlay" onClick={() => setMostrarResumo(false)}>
          <div className="resumo-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setMostrarResumo(false)} aria-label="Fechar">
              ✕
            </button>
            <h3 className="resumo-titulo">📋 Resumo — {cliente.nome}</h3>
            <div className="resumo-lista">
              {resumoItens.map((it) => (
                <div key={it.nome} className="resumo-item">
                  <span className="ri-qtd">{it.qtd}×</span>
                  <span className="ri-nome">{it.nome}</span>
                  <span className="ri-total">{money(it.total)}</span>
                </div>
              ))}

              {/* cada lançamento com a hora. É aqui que se tira um item lançado
                  errado — o ✕ que antes ficava solto na tela da mesa. */}
              {consumos.length > 0 && (
                <>
                  <span className="resumo-sub">🕐 Lançamentos · toque no ✕ pra tirar</span>
                  {consumos.map((co) => (
                    <div key={co.id} className="item">
                      <span className="item-hora">🕐 {hora(co.created_at)}</span>
                      <span className="item-desc">
                        {co.quantidade}× {co.beer_nome}
                      </span>
                      <span className="item-valor">
                        {money(co.preco_unit * co.quantidade)}
                      </span>
                      <button className="item-x" onClick={() => onRemove(co.id)}>
                        ✕
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="resumo-total">
              <span>{resumo.qtd} produtos</span>
              <strong>{money(resumo.total)}</strong>
            </div>
            <button
              className="btn-fechar-resumo"
              onClick={() => setMostrarResumo(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {confPagto && (
        <div className="pag-overlay" onClick={() => setConfPagto(false)}>
          <div className="pag-box" onClick={(e) => e.stopPropagation()}>
            <p className="pag-titulo">
              {quitado
                ? `Encerrar a comanda de ${cliente.nome}?`
                : temParcial
                  ? `Receber o resto de ${cliente.nome}?`
                  : `Confirmar pagamento de ${cliente.nome}?`}
            </p>
            <strong className="pag-total">
              {quitado ? money(resumo.total) : money(temParcial ? falta : resumo.total)}
            </strong>
            {quitado ? (
              <span className="pag-sub">Tudo pago ✓ — a comanda vai fechar</span>
            ) : temParcial ? (
              <span className="pag-sub">
                Já pago {money(pago)} · Total {money(resumo.total)}
              </span>
            ) : null}
            {quitado ? (
              // já foi tudo recebido em partes, cada uma com a sua forma:
              // aqui não entra dinheiro nenhum, é só encerrar
              <button className="pag-confirmar" onClick={() => onFechar(cliente.id)}>
                ✓ Encerrar comanda
              </button>
            ) : (
              <>
                {/* Comanda que ficou de outra noite: o dinheiro pode ter entrado
                    LÁ e a comanda só ter ficado aberta por esquecimento. Sem esta
                    escolha, fechar hoje jogaria a entrada no caixa de hoje e as
                    duas noites ficariam erradas. */}
                {noiteAntiga && (
                  <div className="pag-quando">
                    <span className="pag-quando-lbl">Quando esse dinheiro entrou?</span>
                    <div className="forma-chips">
                      <button
                        className={'forma-chip' + (!retro ? ' on' : '')}
                        onClick={() => setRetro(false)}
                      >
                        Agora
                      </button>
                      <button
                        className={'forma-chip' + (retro ? ' on' : '')}
                        onClick={() => setRetro(true)}
                      >
                        🌙 Na noite de {diaBonito(noiteAntiga)}
                      </button>
                    </div>
                    {retro && (
                      <span className="pag-quando-aviso">
                        ⚠️ Vai entrar no caixa da noite de {diaBonito(noiteAntiga)}, que
                        já foi conferida. Use só se ele pagou mesmo naquele dia e a
                        comanda ficou aberta por esquecimento.
                      </span>
                    )}
                  </div>
                )}
                <span className="pag-como">Como pagou?</span>
                <div className="pag-formas">
                  {FORMAS_PAGAMENTO.map((f) => (
                    <button
                      key={f.id}
                      className="pag-forma"
                      onClick={() => onFechar(cliente.id, f.id, retro ? noiteAntiga : null)}
                    >
                      <span className="pag-forma-ic">{f.icone}</span>
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button
              className="pag-cancelar"
              onClick={() => {
                setConfPagto(false)
                setRetro(false)
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {parteAberto && (
        <div className="parte-overlay" onClick={fecharParte}>
          <div className="parte-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x" onClick={fecharParte} aria-label="Fechar">
              ✕
            </button>
            <h3 className="parte-tit">👥 Dividir a conta — {cliente.nome}</h3>
            <div className="parte-falta">
              Falta pagar <strong>{money(falta)}</strong>
              {garrafasFalta > 0 && <em> ≈ {garrafasFalta} 🍺</em>}
            </div>

            <div className="parte-modos">
              <button
                className={modoParte === 'garrafa' ? 'pm on' : 'pm'}
                onClick={() => setModoParte('garrafa')}
              >
                🍺 Escolher garrafas
              </button>
              <button
                className={modoParte === 'valor' ? 'pm on' : 'pm'}
                onClick={() => setModoParte('valor')}
              >
                💵 Digitar valor
              </button>
            </div>

            {modoParte === 'garrafa' ? (
              <>
                <div className="parte-itens">
                  {garrafas.pendentesGrp.length === 0 && (
                    <p className="vazio">Tudo pago! 🎉 Nada faltando.</p>
                  )}
                  {garrafas.pendentesGrp.map((it) => {
                    const sel = selGarrafas[it.nome] || 0
                    const passou = sel > it.qtd
                    return (
                      <div key={it.nome} className={'pi-linha' + (passou ? ' pi-passou' : '')}>
                        <div className="pi-txt">
                          <span className="pi-nome">{it.nome}</span>
                          <span className="pi-preco">
                            {money(it.preco)} · falta {it.qtd}
                            {passou && <em className="pi-alerta"> ⚠️ passou de {it.qtd}</em>}
                          </span>
                        </div>
                        <div className="pi-step">
                          <button onClick={() => mudarSel(it.nome, -1)} disabled={sel <= 0}>−</button>
                          <strong>{sel}</strong>
                          <button onClick={() => maisUma(it)}>+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {chipsForma}
                <button
                  className="parte-confirmar"
                  disabled={somaGarrafas <= 0}
                  onClick={() => {
                    const itensPagos = garrafas.pendentesGrp
                      .filter((it) => (selGarrafas[it.nome] || 0) > 0)
                      .map((it) => ({ nome: it.nome, qtd: selGarrafas[it.nome], preco: it.preco }))
                    confirmarParte(somaGarrafas, qtdGarrafas, itensPagos)
                  }}
                >
                  ✓ Receber {money(somaGarrafas)}
                  {qtdGarrafas > 0 && (
                    <span className="pc-sub"> ({qtdGarrafas} 🍺{garrafaResto ? ' · resto' : ''})</span>
                  )}
                </button>
              </>
            ) : (
              <>
                {falta > 0 && (
                  <div className="parte-dividir">
                    <span className="pd-lbl">Dividir entre quantas pessoas?</span>
                    <div className="pd-ctrl">
                      <div className="pi-step">
                        <button
                          onClick={() => escolherPessoas(Math.max(1, (pessoas || 1) - 1))}
                          disabled={(pessoas || 1) <= 1}
                        >
                          −
                        </button>
                        <strong>{pessoas || 1}</strong>
                        <button onClick={() => escolherPessoas((pessoas || 1) + 1)}>+</button>
                      </div>
                      <span className="pd-cada">
                        {money(falta / (pessoas || 1))} <em>cada</em>
                      </span>
                    </div>
                  </div>
                )}
                <input
                  className="parte-input"
                  inputMode="decimal"
                  placeholder="Ou digite um valor (R$)"
                  value={valorParte}
                  onChange={(e) => {
                    setPessoas(0)
                    setValorParte(e.target.value)
                  }}
                />
                {chipsForma}
                <button
                  className="parte-confirmar"
                  disabled={!(valorDigitado > 0)}
                  onClick={() => confirmarParte(valorDigitado, null)}
                >
                  ✓ Receber {money(valorDigitado)}
                </button>
              </>
            )}

            <button className="parte-cancelar" onClick={fecharParte}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {excesso && (
        <div className="excesso-overlay" onClick={() => setExcesso(null)}>
          <div className="excesso-box" onClick={(e) => e.stopPropagation()}>
            <span className="excesso-ic">⚠️</span>
            <p className="excesso-tit">Passou do que falta!</p>
            <p className="excesso-txt">
              Falta só <b>{money(falta)}</b> e você está cobrando <b>{money(excesso.valor)}</b>
              {excesso.valor - falta > 0.001 && (
                <> — <b>{money(excesso.valor - falta)}</b> a mais</>
              )}.
            </p>
            <button className="excesso-ok" onClick={confirmarExcesso}>
              Cobrar {money(excesso.valor)} mesmo assim
            </button>
            <button className="excesso-voltar" onClick={() => setExcesso(null)}>
              Voltar e ajustar
            </button>
          </div>
        </div>
      )}

      {confGarrafa && (
        <div className="excesso-overlay" onClick={() => setConfGarrafa(null)}>
          <div className="excesso-box" onClick={(e) => e.stopPropagation()}>
            <span className="excesso-ic">⚠️</span>
            <p className="excesso-tit">Passou do que tem na mesa!</p>
            <p className="excesso-txt">
              Só tem <b>{confGarrafa.qtd}× {confGarrafa.nome}</b> na mesa e você está marcando{' '}
              <b>{confGarrafa.alvo}</b>. Confirma?
            </p>
            <button
              className="excesso-ok"
              onClick={() => {
                mudarSel(confGarrafa.nome, +1)
                setConfGarrafa(null)
              }}
            >
              Sim, marcar {confGarrafa.alvo}
            </button>
            <button className="excesso-voltar" onClick={() => setConfGarrafa(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {verPagos && (() => {
        const pagamentos = [...parciais].sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        )
        const pct = resumo.total > 0 ? Math.min(100, Math.round((pago / resumo.total) * 100)) : 0
        return (
          <div className="pagos-overlay" onClick={() => setVerPagos(false)}>
            <div className="pagos-box" onClick={(e) => e.stopPropagation()}>
              <div className="pagos-topo">
                <button className="voltar" onClick={() => setVerPagos(false)}>
                  ‹ Voltar
                </button>
              </div>
              <h3 className="pagos-tit">🧾 Movimento — {cliente.nome}</h3>

              {/* resumo rápido: barra de progresso pago × falta */}
              <div className="mov-resumo">
                <div className="mov-barra">
                  <div className="mov-barra-fill" style={{ width: pct + '%' }} />
                </div>
                <div className="mov-nums">
                  <span className="mn-pago">
                    ✓ Pago <b>{money(pago)}</b> <em>de {money(resumo.total)}</em>
                  </span>
                  <span className="mn-falta">
                    Falta <b>{money(falta)}</b>
                  </span>
                </div>
              </div>

              <div className="pagos-lista">
                {garrafas.nPagas === 0 && garrafas.nFalta === 0 && (
                  <p className="vazio">Nada lançado ainda.</p>
                )}

                {/* garrafas pagas — verde */}
                {garrafas.pagasGrp.length > 0 && (
                  <div className="mov-bloco mov-bloco-pago">
                    <span className="mov-bloco-tit">✓ Já pago · {garrafas.nPagas} 🍺</span>
                    {garrafas.pagasGrp.map((g) => (
                      <div key={'pg' + g.nome} className="mov-linha">
                        <span className="mov-q">{g.qtd}×</span>
                        <span className="mov-n">{g.nome}</span>
                        <span className="mov-v">{money(g.total)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* garrafas faltando — vermelho */}
                {garrafas.pendentesGrp.length > 0 && (
                  <div className="mov-bloco mov-bloco-falta">
                    <span className="mov-bloco-tit">Falta pagar · {garrafas.nFalta} 🍺</span>
                    {garrafas.pendentesGrp.map((g) => (
                      <div key={'pd' + g.nome} className="mov-linha">
                        <span className="mov-q">{g.qtd}×</span>
                        <span className="mov-n">{g.nome}</span>
                        <span className="mov-v">{money(g.total)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* quando pagaram (horários) */}
                {pagamentos.length > 0 && (
                  <div className="mov-pagtos">
                    <span className="mov-pagtos-tit">🕐 Quando pagaram</span>
                    {pagamentos.map((p) => (
                      <div key={p.id} className="mov-pagto">
                        <span className="pagos-hora">{hora(p.created_at)}</span>
                        <span className="mov-pagto-desc">
                          {p.qtd ? `${p.qtd} 🍺` : 'por valor'}
                        </span>
                        <span className="mov-pagto-v">{money(p.valor)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button className="pagos-voltar" onClick={() => setVerPagos(false)}>
                Voltar
              </button>
            </div>
          </div>
        )
      })()}

      {/* fica escondido na tela — só existe no papel, quando toca em Imprimir */}
      {createPortal(
        <CupomComanda
          loja={loja}
          cliente={cliente}
          itens={resumoItens}
          resumo={resumo}
          parciais={parciais}
          pago={pago}
          falta={falta}
          impressoEm={impressoEm}
        />,
        document.body
      )}

      {confirmar && (() => {
        const cor = corDe(confirmar.nome, confirmar.cor)
        // acabou no estoque? o aviso entra AQUI, no mesmo toque de sempre —
        // ele não some, mas passa a exigir uma escolha consciente
        const aviso = avisoEstoque(estoque.get(confirmar.id), qtd)
        const lancar = () => {
          tocar(confirmar)
          setConfirmar(null)
        }
        return (
          <div className="confirm-overlay" onClick={() => setConfirmar(null)}>
            <div
              className={'confirm-box' + (aviso ? ' confirm-alerta' : '')}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="confirm-x"
                onClick={() => setConfirmar(null)}
                aria-label="Cancelar"
              >
                ✕
              </button>
              <p className="confirm-msg">
                {aviso ? '⚠️ Esse produto acabou no estoque' : 'Clica em OK para confirmar'}
              </p>
              <span
                className="confirm-prod"
                style={{ background: cor.bg, color: cor.fg }}
              >
                {qtd}× {reprDe(confirmar)}
              </span>
              {aviso ? (
                <>
                  <p className="confirm-aviso">
                    {aviso.acabou ? (
                      <>
                        Não tem mais <b>{reprDe(confirmar)}</b> no estoque
                        {aviso.disponivel < 0 ? ` (saldo ${aviso.disponivel}).` : '.'}
                      </>
                    ) : (
                      <>
                        Só tem <b>{aviso.disponivel}</b> de <b>{reprDe(confirmar)}</b> no
                        estoque e você está lançando <b>{aviso.pedido}</b>.
                      </>
                    )}
                    <br />
                    Não dá pra vender o que não tem: entraria dinheiro no caixa sem ter
                    de onde sair da geladeira.
                  </p>
                  <p className="confirm-saida">
                    <b>Chegou mercadoria?</b> Dá a entrada dele na aba <b>Estoque</b> e ele
                    volta a lançar na hora.
                  </p>
                  <button className="confirm-fechar" onClick={() => setConfirmar(null)}>
                    Entendi
                  </button>
                </>
              ) : (
                <button className="confirm-ok" onClick={lancar}>
                  OK
                </button>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ===================== Cupom de conferência =====================
// O papel que sai na impressora térmica (bobina de 58 ou 80 mm). NÃO é documento
// fiscal — é a conferência do dono: "essa mesa levou tanto". Na tela ele não
// aparece; quem o traz à tona é o @media print (ver .cupom em styles.css).
// Fica pendurado no <body> (portal) pra o CSS conseguir apagar o app inteiro e
// deixar só ele no papel.
function CupomComanda({ loja, cliente, itens, resumo, parciais = [], pago = 0, falta = 0, impressoEm }) {
  // marca o body enquanto o cupom existe. É o que deixa o CSS esconder o app
  // sem depender do seletor :has(), que celular velho pode não ter.
  useEffect(() => {
    document.body.classList.add('tem-cupom')
    return () => document.body.classList.remove('tem-cupom')
  }, [])

  const dataHora = (ts) =>
    new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  // o que já entrou nesta comanda, por forma (quando a conta foi dividida)
  const porForma = new Map()
  for (const p of parciais)
    porForma.set(p.forma || null, (porForma.get(p.forma || null) || 0) + Number(p.valor || 0))

  return (
    <div className="cupom">
      <div className="cup-loja">{loja}</div>
      <div className="cup-sub">Conferência de comanda</div>
      <div className="cup-linha" />

      <div className="cup-nome">{cliente.nome}</div>
      <div className="cup-row cup-mini">
        <span>Aberta</span>
        <span>{dataHora(cliente.created_at)}</span>
      </div>
      {impressoEm && (
        <div className="cup-row cup-mini">
          <span>Impressa</span>
          <span>{dataHora(impressoEm)}</span>
        </div>
      )}
      <div className="cup-linha" />

      <div className="cup-itens">
        {itens.map((it) => (
          <div key={it.nome} className="cup-row">
            <span className="cup-q">{it.qtd}x</span>
            <span className="cup-n">{it.nome}</span>
            <span className="cup-v">{money(it.total)}</span>
          </div>
        ))}
      </div>
      <div className="cup-linha" />

      <div className="cup-row cup-mini">
        <span>Itens</span>
        <span>{resumo.qtd}</span>
      </div>
      <div className="cup-row cup-total">
        <span>TOTAL</span>
        <span>{money(resumo.total)}</span>
      </div>

      {pago > 0.009 && (
        <>
          <div className="cup-linha" />
          {[...porForma.entries()].map(([forma, valor]) => (
            <div key={forma || 'outro'} className="cup-row cup-mini">
              <span>Pago · {nomeForma(forma)}</span>
              <span>{money(valor)}</span>
            </div>
          ))}
          <div className="cup-row cup-total">
            {falta > 0.009 ? (
              <>
                <span>FALTA</span>
                <span>{money(falta)}</span>
              </>
            ) : (
              <>
                <span>TUDO PAGO</span>
                <span>✓</span>
              </>
            )}
          </div>
        </>
      )}

      <div className="cup-linha" />
      <div className="cup-rodape">
        NÃO É DOCUMENTO FISCAL
        <br />
        conferência interna
      </div>
    </div>
  )
}

// VENDA RÁPIDA (balcão): monta um carrinho, toca nos produtos e vende de uma vez.
// Não abre comanda com nome — quem chama (App.venderBalcao) grava como venda fechada.
function VendaBalcao({ cervejas, estoque = new Map(), onVender, onVoltar }) {
  const [carrinho, setCarrinho] = useState({}) // {cervejaId: qtd}
  const [busca, setBusca] = useState('')
  const [confVenda, setConfVenda] = useState(false) // confirmação antes de fechar a venda
  const [dividirN, setDividirN] = useState(1) // dividir a venda entre N pessoas (caixinha)
  const [bloqueado, setBloqueado] = useState(null) // produto barrado por falta de estoque

  // Aqui o toque no card já joga no carrinho — não tem confirmação no meio como
  // na comanda. Então a barreira do estoque tem que estar NESTE toque: é por
  // aqui que uma venda sem saldo entrava sem ninguém ver.
  function add(c) {
    const aviso = avisoEstoque(estoque.get(c.id), (carrinho[c.id] || 0) + 1)
    if (aviso) {
      setBloqueado({ c, aviso })
      return
    }
    setCarrinho((k) => ({ ...k, [c.id]: (k[c.id] || 0) + 1 }))
  }
  // o mesmo card serve dentro da pasta e no resultado da busca
  const cardProduto = (c) => {
    const cor = corDe(c.nome, c.cor)
    const n = carrinho[c.id] || 0
    const zerado = semEstoque(estoque.get(c.id))
    return (
      <button
        key={c.id}
        className={'prod-card' + (n ? ' destaque' : '')}
        style={{ background: cor.bg, color: cor.fg }}
        onClick={() => add(c)}
      >
        {c.foto && (
          <img
            className="pc-foto"
            src={c.foto}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <span className="pc-nome">
          {c.nome}
          {n > 0 && <span className="pc-badge">{n}</span>}
        </span>
        <span className="pc-info">
          {zerado && <span className="pc-zerado">⚠️ acabou</span>}
          {c.tamanho && <span className="pc-tam">{c.tamanho}</span>}
          <span className="pc-preco">{money(c.preco)}</span>
        </span>
      </button>
    )
  }
  function mudar(id, delta) {
    // o "+" do carrinho é a mesma porta do toque no card: barra igual
    if (delta > 0) {
      const c = cervejas.find((x) => x.id === id)
      const aviso = avisoEstoque(estoque.get(id), (carrinho[id] || 0) + delta)
      if (aviso) {
        if (c) setBloqueado({ c, aviso })
        return
      }
    }
    setCarrinho((k) => {
      const novo = Math.max(0, (k[id] || 0) + delta)
      const cp = { ...k }
      if (novo === 0) delete cp[id]
      else cp[id] = novo
      return cp
    })
  }

  const itensCarrinho = cervejas
    .filter((c) => carrinho[c.id])
    .map((c) => ({ cerveja: c, qtd: carrinho[c.id] }))
  const total = itensCarrinho.reduce((s, it) => s + Number(it.cerveja.preco) * it.qtd, 0)
  const totalItens = itensCarrinho.reduce((s, it) => s + it.qtd, 0)

  // No balcão nada é gravado até tocar em Vender, então o carrinho INTEIRO é o
  // que vai sair — por isso a conferência é do total de cada produto, não de
  // uma unidade por vez.
  const faltando = itensCarrinho
    .map((it) => ({ it, aviso: avisoEstoque(estoque.get(it.cerveja.id), it.qtd) }))
    .filter((x) => x.aviso)

  return (
    <div className="overlay">
      <div className="detalhe">
        <header className="det-topo">
          <div className="det-topo-row">
            <button className="voltar" onClick={onVoltar}>
              ‹ Voltar
            </button>
          </div>
          <h2>⚡ Venda rápida</h2>
          <span className="balcao-dica">Toque nos produtos e aperte Vender — sem abrir comanda.</span>
        </header>

        <PastasDeProdutos
          produtos={cervejas}
          busca={busca}
          setBusca={setBusca}
          renderCard={cardProduto}
          badge={(itens) => {
            // quantas unidades desta pasta ja estao no carrinho
            const n = itens.reduce((s, c) => s + (carrinho[c.id] || 0), 0)
            return n > 0 ? `${n} no carrinho` : null
          }}
          vazio={<p className="vazio">Nenhum produto cadastrado.</p>}
          semResultado={() => <p className="vazio">Nenhum produto encontrado.</p>}
        />

        <div className="historico">
          {itensCarrinho.length === 0 && <p className="vazio">Carrinho vazio.</p>}
          {itensCarrinho.map((it) => (
            <div key={it.cerveja.id} className="item">
              <span className="item-desc">
                {it.cerveja.tamanho ? `${it.cerveja.nome} ${it.cerveja.tamanho}` : it.cerveja.nome}
              </span>
              <div className="pi-step balcao-step">
                <button onClick={() => mudar(it.cerveja.id, -1)}>−</button>
                <strong>{it.qtd}</strong>
                <button onClick={() => mudar(it.cerveja.id, +1)}>+</button>
              </div>
              <span className="item-valor">{money(it.cerveja.preco * it.qtd)}</span>
            </div>
          ))}
        </div>

        <footer className="det-rodape">
          <div className="rodape-linha1">
            <div className="total-grande total-topo">
              <span className="tg-itens">{totalItens} item{totalItens === 1 ? '' : 's'}</span>
              <strong>{money(total)}</strong>
            </div>
            {total > 0 && (
              <div className="mesa-dividir">
                <span className="md-lbl">Dividir entre quantas pessoas?</span>
                <div className="md-ctrl">
                  <div className="md-step">
                    <button onClick={() => setDividirN((n) => Math.max(1, n - 1))} disabled={dividirN <= 1}>
                      −
                    </button>
                    <strong>{dividirN}</strong>
                    <button onClick={() => setDividirN((n) => n + 1)}>+</button>
                  </div>
                  <span className="md-eq">= {money(total / dividirN)} cada</span>
                </div>
              </div>
            )}
          </div>
          <button
            className="btn-pagar"
            disabled={itensCarrinho.length === 0}
            onClick={() => setConfVenda(true)}
          >
            ✓ Vender {money(total)}
          </button>
        </footer>
      </div>

      {confVenda && (
        <div className="pag-overlay" onClick={() => setConfVenda(false)}>
          <div className="pag-box" onClick={(e) => e.stopPropagation()}>
            <p className="pag-titulo">Confirmar venda de balcão?</p>
            <strong className="pag-total">{money(total)}</strong>
            <div className="venda-itens">
              {itensCarrinho.map((it) => (
                <div key={it.cerveja.id} className="venda-item">
                  <span>
                    {it.qtd}×{' '}
                    {it.cerveja.tamanho
                      ? `${it.cerveja.nome} ${it.cerveja.tamanho}`
                      : it.cerveja.nome}
                  </span>
                  <b>{money(it.cerveja.preco * it.qtd)}</b>
                </div>
              ))}
            </div>
            {/* Última porta. O carrinho já é barrado no toque, mas o saldo pode
                ter mudado no meio do caminho — outro celular vendeu a última
                enquanto esta tela estava aberta. Aqui a venda não sai. */}
            {faltando.length > 0 ? (
              <>
                <div className="venda-alerta">
                  <span className="va-tit">⚠️ Esse produto acabou no estoque</span>
                  {faltando.map(({ it, aviso }) => (
                    <div key={it.cerveja.id} className="va-linha">
                      <span>{reprProduto(it.cerveja)}</span>
                      <b>
                        {aviso.acabou
                          ? 'acabou'
                          : `só tem ${aviso.disponivel} de ${aviso.pedido}`}
                      </b>
                    </div>
                  ))}
                  <span className="va-txt">
                    Tire do carrinho pra vender o resto — ou dá a entrada deles na aba
                    Estoque, se a mercadoria chegou.
                  </span>
                </div>
                <button className="pag-cancelar" onClick={() => setConfVenda(false)}>
                  ‹ Voltar e ajustar o carrinho
                </button>
              </>
            ) : (
              <>
                <span className="pag-como">Como pagou?</span>
                <div className="pag-formas">
                  {FORMAS_PAGAMENTO.map((f) => (
                    <button
                      key={f.id}
                      className="pag-forma"
                      onClick={() => onVender(itensCarrinho, f.id)}
                    >
                      <span className="pag-forma-ic">{f.icone}</span>
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="pag-cancelar" onClick={() => setConfVenda(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Barreira do estoque no toque do card. Sem saída de "vender assim
          mesmo": o caminho pra vender é dar entrada da mercadoria. */}
      {bloqueado && (
        <div className="excesso-overlay" onClick={() => setBloqueado(null)}>
          <div className="excesso-box" onClick={(e) => e.stopPropagation()}>
            <span className="excesso-ic">⚠️</span>
            <p className="excesso-tit">Esse produto acabou no estoque</p>
            <p className="excesso-txt">
              {bloqueado.aviso.acabou ? (
                <>
                  Não tem mais <b>{reprProduto(bloqueado.c)}</b> no estoque
                  {bloqueado.aviso.disponivel < 0
                    ? ` (saldo ${bloqueado.aviso.disponivel}).`
                    : '.'}
                </>
              ) : (
                <>
                  Só tem <b>{bloqueado.aviso.disponivel}</b> de{' '}
                  <b>{reprProduto(bloqueado.c)}</b> no estoque.
                </>
              )}
              <br />
              Não dá pra vender o que não tem: entraria dinheiro no caixa sem ter de
              onde sair da geladeira.
            </p>
            <p className="confirm-saida">
              <b>Chegou mercadoria?</b> Dá a entrada dele na aba <b>Estoque</b> e ele
              volta a vender na hora.
            </p>
            <button className="excesso-voltar" onClick={() => setBloqueado(null)}>
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AbaCervejas({ cervejas, setCervejas, onErro, onLog }) {
  const [nome, setNome] = useState('')
  const [tamanho, setTamanho] = useState('') // livre: "600ml", "Lata", "Litrão"…
  const [precoNovo, setPrecoNovo] = useState('')
  const [corSel, setCorSel] = useState('') // '' = automática
  const [editId, setEditId] = useState(null)
  const [editNome, setEditNome] = useState('')
  const [editTam, setEditTam] = useState('')

  // agrupa a lista de preços por marca
  const gruposPreco = useMemo(() => {
    const map = new Map()
    for (const c of cervejas) {
      if (!map.has(c.nome)) map.set(c.nome, [])
      map.get(c.nome).push(c)
    }
    return [...map.entries()]
  }, [cervejas])

  const sugMarca = useMemo(() => sugerirMarcas(nome), [nome])

  async function salvarPreco(id, valor) {
    const v = Number(String(valor).replace(',', '.')) || 0
    const antigo = cervejas.find((c) => c.id === id)
    const { error } = await supabase.from('cervejas').update({ preco: v }).eq('id', id)
    if (error) return onErro('⚠️ Não salvou o preço. Tente de novo.')
    setCervejas((cs) => cs.map((c) => (c.id === id ? { ...c, preco: v } : c)))
    if (antigo && Number(antigo.preco) !== v)
      onLog?.(
        'mudar_preco',
        `Preço de ${antigo.nome}${antigo.tamanho ? ' ' + antigo.tamanho : ''}: ${money(antigo.preco)} → ${money(v)}`,
        { id, antes: Number(antigo.preco), depois: v }
      )
  }

  function abrirEdicao(c) {
    setEditId(c.id)
    setEditNome(c.nome)
    setEditTam(c.tamanho || '')
  }
  async function salvarEdicao() {
    const nm = editNome.trim()
    if (!nm) return
    const tam = editTam.trim()
    const antigo = cervejas.find((c) => c.id === editId)
    const de = antigo ? (antigo.tamanho ? `${antigo.nome} ${antigo.tamanho}` : antigo.nome) : null
    const para = tam ? `${nm} ${tam}` : nm
    const { error } = await supabase
      .from('cervejas')
      .update({ nome: nm, tamanho: tam })
      .eq('id', editId)
    if (error) return onErro('⚠️ Não salvou a edição. Tente de novo.')
    // As vendas guardam o NOME do produto, não o id (`consumos.beer_nome`). Trocar
    // só o nome aqui deixava as vendas antigas com o nome velho: o estoque parava
    // de descontá-las e o "Mais vendidos" mostrava o mesmo produto partido em dois.
    // O renomear do Estoque e o desfazer do Histórico já levavam o histórico junto
    // — só este aqui não levava.
    if (de && de !== para) {
      await supabase.from('consumos').update({ beer_nome: para }).eq('beer_nome', de)
      await supabase.from('perdas').update({ beer_nome: para }).eq('beer_nome', de)
    }
    setCervejas((cs) =>
      cs.map((c) => (c.id === editId ? { ...c, nome: nm, tamanho: tam } : c))
    )
    if (antigo)
      onLog?.(
        'editar_produto',
        `Editou produto: ${antigo.nome}${antigo.tamanho ? ' ' + antigo.tamanho : ''} → ${nm}${tam ? ' ' + tam : ''}`,
        {
          id: editId,
          antes: { nome: antigo.nome, tamanho: antigo.tamanho || '' },
          depois: { nome: nm, tamanho: tam },
        }
      )
    setEditId(null)
  }

  async function adicionar() {
    const n = nome.trim()
    if (!n) return
    const preco = Number(String(precoNovo).replace(',', '.')) || 0
    const tam = tamanho.trim()
    const ordem = cervejas.reduce((m, c) => Math.max(m, c.ordem ?? 0), 0) + 1
    const linha = { nome: n, tamanho: tam, preco, ordem, cor: corSel || null }

    // tenta com a coluna "cor"; se ela ainda não existe no banco, salva sem ela
    let res = await supabase.from('cervejas').insert(linha).select()
    if (res.error && /cor/i.test(res.error.message || '')) {
      const { cor, ...semCor } = linha
      res = await supabase.from('cervejas').insert(semCor).select()
    }
    if (res.error || !res.data) {
      return onErro('⚠️ Não consegui salvar o produto. Tente de novo.')
    }
    setCervejas((cs) => [...cs, ...res.data])
    onLog?.('add_produto', `Adicionou produto: ${n}${tam ? ' ' + tam : ''}`, {
      ids: res.data.map((r) => r.id),
    })
    setNome('')
    setTamanho('')
    setPrecoNovo('')
    setCorSel('')
  }

  async function remover(id) {
    if (!confirm('Remover este produto da lista?')) return
    const prod = cervejas.find((c) => c.id === id)
    const { error } = await supabase.from('cervejas').update({ ativo: false }).eq('id', id)
    if (error) return onErro('⚠️ Não consegui remover. Tente de novo.')
    setCervejas((cs) => cs.filter((c) => c.id !== id))
    if (prod)
      onLog?.(
        'remover_produto',
        `Removeu produto: ${prod.nome}${prod.tamanho ? ' ' + prod.tamanho : ''}`,
        { produto: prod }
      )
  }

  return (
    <main className="conteudo">
      <h3 className="sec">Preços dos produtos</h3>
      <div className="lista-cervejas">
        {cervejas.length === 0 && (
          <p className="vazio">Nenhum produto ainda. Cadastre abaixo.</p>
        )}
        {gruposPreco.map(([marca, itens]) => (
          <div key={marca} className="grupo-preco">
            <div className="gp-cabec" style={{ background: corDe(marca, itens[0].cor).bg, color: corDe(marca, itens[0].cor).fg }}>
              {marca}
            </div>
            {itens.map((c) =>
              editId === c.id ? (
                <div key={c.id} className="linha-cerveja editando">
                  <input
                    className="campo edit-campo"
                    value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    placeholder="Marca"
                  />
                  <input
                    className="campo edit-campo"
                    value={editTam}
                    onChange={(e) => setEditTam(e.target.value)}
                    placeholder="Formato"
                  />
                  <button className="btn-mini ok" onClick={salvarEdicao}>✓</button>
                  <button className="btn-mini" onClick={() => setEditId(null)}>✕</button>
                </div>
              ) : (
                <div key={c.id} className="linha-cerveja">
                  <span className="lc-nome">{c.tamanho || '— (único)'}</span>
                  <div className="lc-preco">
                    <span>R$</span>
                    <input
                      className="campo-preco"
                      type="number"
                      step="0.50"
                      inputMode="decimal"
                      defaultValue={Number(c.preco).toFixed(2)}
                      onBlur={(e) => salvarPreco(c.id, e.target.value)}
                    />
                  </div>
                  <button className="lc-edit" onClick={() => abrirEdicao(c)} aria-label="Editar">
                    ✏️
                  </button>
                  <button className="lc-x" onClick={() => remover(c.id)} aria-label="Remover">
                    ✕
                  </button>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      <h3 className="sec">Adicionar produto</h3>
      <div className="form-produto">
        <input
          className="campo"
          placeholder="Nome do produto (ex: Coca-Cola, Brahma, Água)"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        {sugMarca && (
          <div className="sug-marca">
            <span className="tam-label">
              {sugMarca.correcao ? '🤔 Você quis dizer?' : 'Sugestões:'}
            </span>
            <div className="chips">
              {sugMarca.nomes.map((m) => (
                <button key={m} className="chip chip-sug" onClick={() => setNome(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="prod-linha">
          <input
            className="campo prod-tam"
            placeholder="Tamanho (ex: 600ml, Lata, 1L)"
            value={tamanho}
            onChange={(e) => setTamanho(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adicionar()}
          />
          <div className="prod-preco">
            <span>R$</span>
            <input
              className="campo"
              placeholder="0,00"
              type="number"
              step="0.50"
              inputMode="decimal"
              value={precoNovo}
              onChange={(e) => setPrecoNovo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionar()}
            />
          </div>
        </div>
        <p className="prod-dica">O tamanho é opcional — se não tiver, deixa em branco.</p>

        <div className="cor-sec">
          <span className="tam-label">Cor do card:</span>
          <div className="cores">
            <button
              className={'swatch swatch-auto' + (corSel === '' ? ' on' : '')}
              onClick={() => setCorSel('')}
              title="Automática"
            >
              auto
            </button>
            {PALETA.map((c) => (
              <button
                key={c}
                className={'swatch' + (corSel === c ? ' on' : '')}
                style={{ background: c }}
                onClick={() => setCorSel(c)}
                aria-label={'Cor ' + c}
              />
            ))}
          </div>
        </div>

        <button className="btn-grande" onClick={adicionar}>
          + Salvar produto
        </button>
      </div>
    </main>
  )
}

// ícone e cor de cada tipo de movimentação no histórico.
// "+" (lançar) fica verde e "−" (remover) fica vermelho via classe CSS.
const HIST_INFO = {
  abrir_cliente: { icone: '🟢' },
  excluir_cliente: { icone: '🗑️' },
  fechar_cliente: { icone: '✅' },
  lancar_consumo: { icone: '+', cls: 'hi-add' },
  remover_consumo: { icone: '−', cls: 'hi-rem' },
  pagar_parte: { icone: '💰' },
  renomear_cliente: { icone: '✏️' },
  venda_balcao: { icone: '⚡' },
  perda: { icone: '🗑️', cls: 'hi-rem' },
  abrir_caixa: { icone: '🔓' },
  fechar_caixa: { icone: '🔒' },
  add_produto: { icone: '🆕' },
  remover_produto: { icone: '❌' },
  editar_produto: { icone: '✏️' },
  mudar_preco: { icone: '💲' },
}

// a qual pasta FIXA do histórico cada tipo pertence (o lojista não cria pastas
// aqui — são só 3, pra organizar a leitura).
const PASTA_HIST = {
  abrir_cliente: 'comanda',
  fechar_cliente: 'comanda',
  excluir_cliente: 'comanda',
  lancar_consumo: 'comanda',
  remover_consumo: 'comanda',
  pagar_parte: 'comanda',
  renomear_cliente: 'comanda',
  venda_balcao: 'balcao',
  perda: 'perdas',
  abrir_caixa: 'caixa',
  fechar_caixa: 'caixa',
  add_produto: 'estoque',
  remover_produto: 'estoque',
  editar_produto: 'estoque',
  mudar_preco: 'estoque',
}
const pastaDeHist = (h) => PASTA_HIST[h.tipo] || 'comanda'

// descobre a qual comanda (pessoa) uma movimentação pertence.
// id null = movimentação de produto/catálogo (sem pessoa).
function refCliente(h) {
  const p = h.payload || {}
  if (h.tipo === 'lancar_consumo' || h.tipo === 'remover_consumo') {
    const nome = (h.descricao.split(' — ')[1] || '').trim()
    return { id: p.consumo?.cliente_id || null, nome }
  }
  if (p.cliente) return { id: p.cliente.id || null, nome: p.cliente.nome || '' }
  return { id: null, nome: '' } // produtos / preço
}

// uma linha do histórico. A exclusão de comanda mostra, embaixo, os itens
// que estavam dentro (pra ver o que foi perdido).
function LinhaHist({ h, onReverter }) {
  const info = HIST_INFO[h.tipo] || { icone: '•' }
  const isConsumo = h.tipo === 'lancar_consumo' || h.tipo === 'remover_consumo'
  // dentro do bloco da pessoa, o "— Nome" é redundante: tira
  const desc = isConsumo ? h.descricao.split(' — ')[0] : h.descricao
  const perdidos = h.tipo === 'excluir_cliente' ? h.payload?.consumos || [] : null
  return (
    <div className="hist-linha">
      <div className="hl-row">
        <span className={'hist-icone ' + (info.cls || '')}>{info.icone}</span>
        <div className="hist-corpo">
          <span className="hist-desc">{desc}</span>
          <span className="hist-hora">🕐 {hora(h.created_at)}</span>
        </div>
        {h.revertido ? (
          <span className="hist-feito">desfeito</span>
        ) : (
          <button className="hist-undo" onClick={() => onReverter(h)}>
            ↩ Desfazer
          </button>
        )}
      </div>
      {perdidos && perdidos.length > 0 && (
        <ul className="hl-itens">
          {perdidos.map((c) => (
            <li key={c.id}>
              <span>
                {c.quantidade}× {c.beer_nome}
              </span>
              <span className="hli-val">{money(c.preco_unit * c.quantidade)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AbaHistorico({ historico, onReverter }) {
  const [pastaAberta, setPastaAberta] = useState(null) // null | 'comanda' | 'balcao' | 'estoque'
  // blocos de comanda começam FECHADOS; guardamos quais foram abertos pelo toque
  const [abertos, setAbertos] = useState(() => new Set())
  const toggle = (id) =>
    setAbertos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // separa o histórico nas 3 pastas fixas
  const grupos = useMemo(() => {
    const g = { comanda: [], balcao: [], estoque: [], perdas: [], caixa: [] }
    for (const h of historico) (g[pastaDeHist(h)] || g.comanda).push(h)
    return g
  }, [historico])

  // dentro de Comandas: agrupa por comanda (pessoa/mesa), como antes
  const blocos = useMemo(() => {
    const map = new Map()
    for (const h of grupos.comanda) {
      const r = refCliente(h)
      const key = r.id || 'h_' + h.id
      if (!map.has(key)) map.set(key, { id: key, nome: '', itens: [] })
      const b = map.get(key)
      if (!b.nome && r.nome) b.nome = r.nome
      b.itens.push(h)
    }
    return [...map.values()]
  }, [grupos.comanda])

  const PASTAS = [
    { id: 'comanda', icone: '🧾', nome: 'Comandas', n: grupos.comanda.length },
    { id: 'balcao', icone: '⚡', nome: 'Vendas rápidas', n: grupos.balcao.length },
    { id: 'estoque', icone: '📦', nome: 'Estoque / Produtos', n: grupos.estoque.length },
    { id: 'perdas', icone: '🗑️', nome: 'Perdas', n: grupos.perdas.length },
    { id: 'caixa', icone: '🔐', nome: 'Caixa (abriu / fechou)', n: grupos.caixa.length },
  ]
  const plural = (n) => (n === 1 ? 'movimentação' : 'movimentações')
  const estadoDe = (itens) => {
    if (itens.some((h) => h.tipo === 'excluir_cliente'))
      return { icone: '🗑️', cls: 'h-excluir' }
    if (itens.some((h) => h.tipo === 'fechar_cliente'))
      return { icone: '✅', cls: 'h-fechar' }
    return { icone: '🟢', cls: 'h-abrir' }
  }

  // ---------- LISTA DE PASTAS ----------
  if (!pastaAberta) {
    return (
      <main className="conteudo">
        <h3 className="sec">Histórico — últimas 24h</h3>
        <p className="hist-aviso">
          Organizado por pasta. Toque numa pasta pra ver o que rolou. Fica 24h aqui
          (e ~30 dias guardado no servidor). Dá pra desfazer.
        </p>
        {historico.length === 0 ? (
          <p className="vazio">Nenhuma movimentação nas últimas 24 horas.</p>
        ) : (
          <div className="est-folders">
            {PASTAS.map((p) => (
              <button
                key={p.id}
                className="est-folder"
                onClick={() => setPastaAberta(p.id)}
              >
                <span className="est-folder-ic">{p.icone}</span>
                <div className="est-folder-txt">
                  <span className="est-folder-nome">{p.nome}</span>
                  <span className="est-folder-sub">
                    {p.n} {plural(p.n)}
                  </span>
                </div>
                <span className="est-folder-seta">›</span>
              </button>
            ))}
          </div>
        )}
      </main>
    )
  }

  // ---------- DENTRO DE UMA PASTA ----------
  const pasta = PASTAS.find((p) => p.id === pastaAberta)
  return (
    <main className="conteudo">
      <div className="est-nav">
        <button className="est-voltar" onClick={() => setPastaAberta(null)}>
          ‹ Voltar
        </button>
        <span className="est-nav-tit">
          {pasta.icone} {pasta.nome}
        </span>
      </div>

      {pastaAberta === 'comanda' ? (
        blocos.length === 0 ? (
          <p className="vazio">Nenhuma movimentação de comanda.</p>
        ) : (
          blocos.map((b) => {
            const est = estadoDe(b.itens)
            const aberto = abertos.has(b.id)
            return (
              <div key={b.id} className={'hist-bloco ' + est.cls + (aberto ? ' on' : '')}>
                <button className="hist-bloco-cab" onClick={() => toggle(b.id)}>
                  <span className="hbc-icone">{est.icone}</span>
                  <div className="hbc-texto">
                    <span className="hbc-nome">{b.nome || 'Comanda'}</span>
                    <span className="hbc-meta">
                      {b.itens.length} {plural(b.itens.length)} · 🕐 {hora(b.itens[0].created_at)}
                    </span>
                  </div>
                  <span className="hbc-acao">{aberto ? '▾ fechar' : 'abrir ›'}</span>
                </button>
                {aberto && (
                  <div className="hist-bloco-itens">
                    {b.itens.map((h) => (
                      <LinhaHist key={h.id} h={h} onReverter={onReverter} />
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )
      ) : grupos[pastaAberta].length === 0 ? (
        <p className="vazio">Nada por aqui ainda.</p>
      ) : (
        <div className="hist-lista">
          {grupos[pastaAberta].map((h) => (
            <LinhaHist key={h.id} h={h} onReverter={onReverter} />
          ))}
        </div>
      )}
    </main>
  )
}

// ===================== Módulo: Cozinha (v1) =====================
// Lê os lançamentos: os que são de produto "vai_cozinha" e ainda não foram
// marcados prontos formam a fila da cozinha. O cozinheiro toca "Pronto" e o item
// sai da fila. Não mexe no fluxo de lançar — só marca um pronto_em no consumo.
function haQuanto(ts) {
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return min + ' min'
  const h = Math.floor(min / 60)
  return h + ' h' + (min % 60 ? ' ' + (min % 60) + 'min' : '')
}

function AbaCozinha({ cervejas, setCervejas, consumos, setConsumos, clientes, virada = HORA_VIRADA, onErro }) {
  const [verConfig, setVerConfig] = useState(false)
  const [verProntos, setVerProntos] = useState(false)
  const reprDe = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

  const reprsCozinha = useMemo(() => {
    const s = new Set()
    for (const c of cervejas) if (c.vai_cozinha) s.add(reprDe(c))
    return s
  }, [cervejas])

  const nomePorCliente = useMemo(() => {
    const m = new Map()
    for (const c of clientes) m.set(c.id, c.nome)
    return m
  }, [clientes])

  const desde12h = Date.now() - 12 * 60 * 60 * 1000
  // "Prontos hoje" usava meia-noite: às 00:01 a lista zerava no meio do
  // movimento, bem quando o cozinheiro pode precisar conferir o que já saiu.
  // Aqui vale a mesma noite do resto do app (ver "O DIA DO BAR" lá em cima).
  const noiteAgora = diaDoBar(Date.now(), virada)

  // fila: itens de cozinha, não prontos, das últimas 12h — agrupados por comanda
  const fila = useMemo(() => {
    const map = new Map()
    for (const co of consumos) {
      if (!reprsCozinha.has(co.beer_nome) || co.pronto_em) continue
      if (new Date(co.created_at).getTime() < desde12h) continue
      if (!map.has(co.cliente_id))
        map.set(co.cliente_id, {
          id: co.cliente_id,
          nome: nomePorCliente.get(co.cliente_id) || 'Comanda',
          itens: [],
          desde: co.created_at,
        })
      const b = map.get(co.cliente_id)
      b.itens.push(co)
      if (new Date(co.created_at) < new Date(b.desde)) b.desde = co.created_at
    }
    // comanda mais antiga primeiro (FIFO — cozinha faz por ordem de chegada)
    return [...map.values()].sort((a, b) => new Date(a.desde) - new Date(b.desde))
  }, [consumos, reprsCozinha, nomePorCliente])

  const prontosHoje = useMemo(
    () =>
      consumos
        .filter(
          (co) =>
            reprsCozinha.has(co.beer_nome) &&
            co.pronto_em &&
            diaDoBar(co.pronto_em, virada) === noiteAgora
        )
        .sort((a, b) => new Date(b.pronto_em) - new Date(a.pronto_em)),
    [consumos, reprsCozinha, noiteAgora, virada]
  )

  async function marcar(ids, pronto) {
    const val = pronto ? new Date().toISOString() : null
    const antes = new Map(
      consumos.filter((c) => ids.includes(c.id)).map((c) => [c.id, c.pronto_em])
    )
    setConsumos((cs) =>
      cs.map((c) => (ids.includes(c.id) ? { ...c, pronto_em: val } : c))
    )
    const { error } = await supabase.from('consumos').update({ pronto_em: val }).in('id', ids)
    if (error) {
      setConsumos((cs) =>
        cs.map((c) => (ids.includes(c.id) ? { ...c, pronto_em: antes.get(c.id) ?? null } : c))
      )
      onErro('⚠️ Não consegui atualizar. Rodou o SQL da Cozinha?')
    }
  }

  async function toggleCozinha(c) {
    const novo = !c.vai_cozinha
    const { error } = await supabase.from('cervejas').update({ vai_cozinha: novo }).eq('id', c.id)
    if (error) return onErro('⚠️ Não salvou. Rodou o SQL da Cozinha?')
    setCervejas((cs) => cs.map((x) => (x.id === c.id ? { ...x, vai_cozinha: novo } : x)))
  }

  return (
    <main className="conteudo">
      {reprsCozinha.size === 0 && !verConfig && (
        <p className="est-aviso">
          Nenhum produto marcado como "vai pra cozinha" ainda. Abra{' '}
          <b>Configurar</b> aqui embaixo e marque os que o cozinheiro prepara
          (espetinho, porção…).
        </p>
      )}

      {reprsCozinha.size > 0 && fila.length === 0 && (
        <p className="vazio">Nenhum pedido na fila. Tudo em dia! 🍳</p>
      )}

      <div className="coz-fila">
        {fila.map((b) => (
          <div key={b.id} className="coz-card">
            <div className="coz-cab">
              <span className="coz-mesa">{b.nome}</span>
              <span className="coz-tempo">🕐 {haQuanto(b.desde)}</span>
            </div>
            <div className="coz-itens">
              {b.itens.map((co) => (
                <button
                  key={co.id}
                  className="coz-item"
                  onClick={() => marcar([co.id], true)}
                >
                  <span className="coz-qtd">{co.quantidade}×</span>
                  <span className="coz-nome">{co.beer_nome}</span>
                  <span className="coz-check">✓ Pronto</span>
                </button>
              ))}
            </div>
            {b.itens.length > 1 && (
              <button
                className="coz-tudo"
                onClick={() => marcar(b.itens.map((c) => c.id), true)}
              >
                ✓ Tudo pronto
              </button>
            )}
          </div>
        ))}
      </div>

      {prontosHoje.length > 0 && (
        <div className="coz-extra">
          <button className="coz-extra-cab" onClick={() => setVerProntos((v) => !v)}>
            {verProntos ? '▾' : '›'} Prontos hoje ({prontosHoje.length})
          </button>
          {verProntos && (
            <div className="coz-extra-lista">
              {prontosHoje.map((co) => (
                <div key={co.id} className="coz-pronto-linha">
                  <span>
                    {co.quantidade}× {co.beer_nome} —{' '}
                    {nomePorCliente.get(co.cliente_id) || 'Comanda'}
                  </span>
                  <button className="coz-reabrir" onClick={() => marcar([co.id], false)}>
                    ↩ voltar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="coz-extra">
        <button className="coz-extra-cab" onClick={() => setVerConfig((v) => !v)}>
          {verConfig ? '▾' : '⚙️'} Configurar — o que vai pra cozinha
        </button>
        {verConfig && (
          <div className="coz-config-lista">
            {cervejas.length === 0 && (
              <p className="vazio">Cadastre produtos na aba Produtos primeiro.</p>
            )}
            {cervejas.map((c) => (
              <label key={c.id} className="coz-config-item">
                <input
                  type="checkbox"
                  checked={!!c.vai_cozinha}
                  onChange={() => toggleCozinha(c)}
                />
                <span>{reprDe(c)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

// ===================== Módulo: Estoque =====================
// Saldo = (contagem inicial + abastecimentos) − (saídas nas comandas desde a
// contagem). A saída já existe nos `consumos` (casados pelo nome do produto).
// Custo da caixa + unidades por caixa dão o custo unitário — e, lá no Relatório,
// o lucro de verdade. Não toca no fluxo das comandas: é só leitura + entradas.
// Pastas do estoque: a categoria é descoberta pelo NOME do produto (sem pedir
// isso no cadastro). O que não bater com nada cai em "Outros".
const CATEGORIAS_ESTOQUE = [
  { id: 'cerveja', label: 'Cerveja', icone: '🍺', kw: ['cerveja', 'chopp', 'brahma', 'skol', 'antarctica', 'original', 'bohemia', 'heineken', 'amstel', 'budweiser', 'stella', 'spaten', 'eisenbahn', 'itaipava', 'petra', 'devassa', 'kaiser', 'schin', 'serramalte', 'bavaria', 'corona', 'becks', 'patagonia', 'imperio', 'colorado', 'praya', 'caracu', 'polar', 'therezopolis', 'baden', 'lokal', 'long neck', 'litrao', 'latao', 'pilsen', 'malte'] },
  { id: 'refri', label: 'Refrigerante', icone: '🥤', kw: ['refri', 'refrigerante', 'coca', 'guarana', 'fanta', 'sprite', 'pepsi', 'kuat', 'schweppes', 'dolly', 'sukita', 'soda', 'tubaina', 'h2oh'] },
  // isotônico (Gatorade/Powerade) fica aqui, não na Água: é assim que o dono
  // compra e pede — junto de Red Bull e Monster, não junto de água mineral.
  { id: 'energetico', label: 'Energético', icone: '⚡', kw: ['energetico', 'energy', 'red bull', 'redbull', 'monster', 'tnt', 'fusion', 'baly', 'red horse', 'burn', 'isotonico', 'gatorade', 'powerade'] },
  { id: 'agua', label: 'Água', icone: '💧', kw: ['agua', 'água', 'bonafont', 'indaia', 'minalba', 'crystal', 'h2o', 'h20'] },
  { id: 'suco', label: 'Suco', icone: '🧃', kw: ['suco', 'kapo', 'delvale', 'del valle', 'todinho', 'nectar'] },
  { id: 'salgadinho', label: 'Salgadinho', icone: '🍟', kw: ['salgad', 'ruffles', 'doritos', 'cheetos', 'torcida', 'torresmo', 'pururuca', 'sanditos', 'fandangos', 'batata', 'amendoim'] },
  { id: 'dose', label: 'Dose', icone: '🥃', kw: ['dose', 'whisky', 'whiskey', 'red label', 'old par', 'cavalo branco', 'velho barreiro', 'compare', 'cachaca', 'vodka', 'gin ', 'conhaque'] },
  { id: 'sorvete', label: 'Sorvete', icone: '🍦', kw: ['sorvete', 'picole', 'iogurte', 'mini torta', 'gelado', 'acai'] },
  { id: 'outros', label: 'Outros', icone: '📦', kw: [] },
]
function categoriaDe(nome) {
  const n = normalizar(nome)
  for (const c of CATEGORIAS_ESTOQUE) {
    if (c.kw.some((k) => n.includes(normalizar(k)))) return c.id
  }
  return 'outros'
}

// label da pasta de um produto: a que o lojista escolheu (c.categoria) ou,
// se não escolheu, a adivinhada pelo nome.
function pastaDe(c) {
  if (c.categoria && c.categoria.trim()) return c.categoria.trim()
  const cat = CATEGORIAS_ESTOQUE.find((x) => x.id === categoriaDe(c.nome))
  return cat ? cat.label : 'Outros'
}
// Pasta criada pelo lojista (nome livre, fora das conhecidas) também ganha
// ícone — numa lista de 10 pastas o desenho é o que o olho acha primeiro.
// O que não bater com nada fica com a etiqueta genérica.
const ICONES_PASTA = {
  'refri lata': '🥫',
  'refri pet': '🧴',
  'refri retornavel': '♻️',
  'comprar': '🛒',
  'doses': '🥃',
  'porcoes': '🍢',
  'gelo': '🧊',
  'cigarro': '🚬',
}
function iconePasta(label) {
  const known = CATEGORIAS_ESTOQUE.find((c) => c.label === label)
  if (known) return known.icone
  return ICONES_PASTA[normalizar(label)] || '🏷️'
}

// Agrupa em pastas. É a MESMA divisão nos três lugares que mostram produto —
// Cadastro/Estoque, comanda e venda rápida: cerveja com cerveja, refri com refri.
// As pastas conhecidas vêm na ordem oficial; as criadas pelo lojista entram
// depois, em ordem alfabética. A ordem DENTRO da pasta é a da lista que chegou
// (na comanda, o último lançado fica no topo — a "preferida" à mão).
//   pegaProduto: pra listas que embrulham o produto (o Estoque manda {c, saldo…})
//   extras: pastas que aparecem mesmo vazias (as que o lojista acabou de criar)
function agruparEmPastas(itens, pegaProduto = (x) => x, extras = []) {
  const map = new Map()
  for (const it of itens) {
    const lbl = pastaDe(pegaProduto(it))
    if (!map.has(lbl)) map.set(lbl, [])
    map.get(lbl).push(it)
  }
  for (const lbl of extras) if (!map.has(lbl)) map.set(lbl, [])
  const ordemConhecida = CATEGORIAS_ESTOQUE.map((c) => c.label)
  const labels = [...map.keys()].sort((a, b) => {
    const ia = ordemConhecida.indexOf(a)
    const ib = ordemConhecida.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.localeCompare(b)
  })
  return labels.map((label) => ({ label, icone: iconePasta(label), itens: map.get(label) }))
}

// ---------- foto do produto: câmera ou galeria do celular ----------
// O balde do Storage onde as fotos ficam. Roda supabase/foto-produto.sql uma
// vez pra criá-lo; sem isso o upload falha e o app avisa (nada mais quebra).
const BUCKET_FOTOS = 'produtos'

// Foto de celular chega com 3–5 MB. Antes de subir, encolhe: 600px no maior
// lado, JPEG. Fica em ~50 KB — sobe rápido no wifi do bar, não come a franquia
// de quem está no 4G e é de sobra pro tamanho que o card mostra.
async function encolherImagem(file, max = 600) {
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    if (!blob) throw new Error('sem blob')
    return { blob, tipo: 'image/jpeg', ext: 'jpg' }
  } catch (_) {
    // celular que não sabe encolher sobe a foto original mesmo
    return {
      blob: file,
      tipo: file.type || 'image/jpeg',
      ext: (file.name?.split('.').pop() || 'jpg').toLowerCase(),
    }
  }
}

// sobe e devolve o endereço público — é ele que vai na coluna `foto`
async function subirFoto(file, cervejaId) {
  const { blob, tipo, ext } = await encolherImagem(file)
  const caminho = `${cervejaId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .upload(caminho, blob, { contentType: tipo })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET_FOTOS).getPublicUrl(caminho)
  return data.publicUrl
}

// ---------- sub-pastas: o segundo nível (Cerveja → 600ml, Lata, Long neck) ----
// A sub-pasta sai da coluna `subcategoria`. Produto SEM sub-pasta fica solto
// dentro da pasta, de propósito: pasta pequena (Dose, Suco) não ganha um nível
// a mais só pra ter — seria um toque a mais no meio do movimento, de graça.
const subPastaDe = (c) => (c.subcategoria && c.subcategoria.trim() ? c.subcategoria.trim() : null)

// o nome da sub-pasta quem escreve é o lojista, então o ícone sai do que ele
// escreveu. Ordem importa: "Lata zero" tem que cair no zero, não na lata.
const ICONES_SUB = [
  ['zero', '0️⃣'],
  ['normal', '🥤'], // "Lata normal" x "Lata zero": o par tem que se distinguir
  ['picole', '🍦'],
  ['ice', '🍹'],
  ['h2o', '💧'],
  ['whisky', '🥃'],
  ['cachaca', '🍶'],
  ['isotonico', '🥤'],
  ['energetico', '⚡'],
  ['com gas', '🫧'],
  ['sem gas', '💧'],
  ['long neck', '🍾'],
  ['garrafa', '🍾'],
  ['600', '🍾'],
  ['300', '🍾'],
  ['litro', '🧴'],
  ['lata', '🥫'],
  ['ks', '♻️'],
  ['ls', '♻️'],
]
function iconeSub(label) {
  const n = normalizar(label)
  for (const [kw, ic] of ICONES_SUB) if (n.includes(kw)) return ic
  return '📂'
}

// separa os itens de UMA pasta entre as sub-pastas e os que ficaram soltos.
// A ordem das sub-pastas é a de aparição na lista que chegou — na comanda isso
// põe na frente a sub-pasta de onde saiu o último lançamento.
function dividirEmSubPastas(itens, pegaProduto = (x) => x) {
  const map = new Map()
  const soltos = []
  for (const it of itens) {
    const sub = subPastaDe(pegaProduto(it))
    if (!sub) {
      soltos.push(it)
      continue
    }
    if (!map.has(sub)) map.set(sub, [])
    map.get(sub).push(it)
  }
  const subs = [...map.entries()].map(([label, itens]) => ({ label, icone: iconeSub(label), itens }))
  return { subs, soltos }
}

// ESTOQUE de cada produto. Fica aqui fora, pura, porque é a outra conta que
// TEM que estar certa: é ela que diz o que precisa comprar.
//
//   saldo = entradas − saídas − perdas
//
// A saída vem dos `consumos` (a venda lançada na comanda ou no balcão) e casa
// pelo NOME do produto. Só conta o que saiu DEPOIS da primeira entrada — a
// contagem inicial é o marco zero; venda anterior a ela já estava descontada
// no número que o dono contou na mão.
function calcularEstoque(cervejas, entradas, consumos, perdas) {
  const repr = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

  const saidasPorNome = new Map()
  for (const co of consumos) {
    if (!saidasPorNome.has(co.beer_nome)) saidasPorNome.set(co.beer_nome, [])
    saidasPorNome.get(co.beer_nome).push({ qtd: co.quantidade, ts: new Date(co.created_at).getTime() })
  }
  const entradasPorCerveja = new Map()
  for (const e of entradas) {
    if (!entradasPorCerveja.has(e.cerveja_id)) entradasPorCerveja.set(e.cerveja_id, [])
    entradasPorCerveja.get(e.cerveja_id).push(e)
  }
  const perdasPorCerveja = new Map()
  for (const p of perdas) {
    if (!p.cerveja_id) continue
    if (!perdasPorCerveja.has(p.cerveja_id)) perdasPorCerveja.set(p.cerveja_id, [])
    perdasPorCerveja.get(p.cerveja_id).push({ qtd: p.quantidade, ts: new Date(p.created_at).getTime() })
  }

  const arr = cervejas.map((c) => {
    const ents = entradasPorCerveja.get(c.id) || []
    const controlado = ents.length > 0
    let entrou = 0
    let desde = Infinity
    for (const e of ents) {
      entrou += Number(e.unidades) || 0
      const t = new Date(e.created_at).getTime()
      if (t < desde) desde = t
    }
    let saiu = 0
    let perdidas = 0
    if (controlado) {
      for (const s of saidasPorNome.get(repr(c)) || []) if (s.ts >= desde) saiu += s.qtd
      for (const p of perdasPorCerveja.get(c.id) || []) if (p.ts >= desde) perdidas += p.qtd
    }
    const saldo = entrou - saiu - perdidas
    const custoUnit =
      c.custo_caixa && c.unidades_caixa ? Number(c.custo_caixa) / Number(c.unidades_caixa) : null
    const min = Number(c.estoque_min) || 0
    let nivel = 'novo'
    if (controlado) nivel = saldo <= 0 ? 'zero' : min > 0 && saldo <= min ? 'baixo' : 'ok'
    return { c, controlado, entrou, saiu, perdidas, saldo, custoUnit, min, nivel, ents }
  })
  // o que precisa de compra sobe pro topo
  const rank = { zero: 0, baixo: 1, ok: 2, novo: 3 }
  return arr.sort((a, b) => rank[a.nivel] - rank[b.nivel] || a.c.nome.localeCompare(b.c.nome))
}

// O AVISO DE ESTOQUE na hora de lançar. É aqui que estoque e caixa se
// encontram: vender o que não tem faz o dinheiro entrar na gaveta sem ter de
// onde sair da geladeira — a partir daí os dois números nunca mais batem, e
// ninguém vê o erro acontecer. Melhor gritar antes do toque do que descobrir
// no fechamento.
//
// Quem NUNCA foi contado (`controlado` falso) não tem saldo pra reclamar: fica
// quieto, senão a loja que ainda não contou o estoque levaria um alerta a cada
// cerveja lançada.
//
// `qtd` é quanto vai sair AGORA. Na comanda é o que está no stepper (o toque
// anterior já virou venda e já baixou o saldo); na venda rápida é o total
// daquele produto no carrinho, que ainda não foi gravado.
function avisoEstoque(est, qtd = 1) {
  if (!est || !est.controlado) return null
  if (est.saldo >= qtd) return null
  return { disponivel: est.saldo, pedido: qtd, acabou: est.saldo <= 0 }
}

// só o "acabou" (pro selo no card do produto, antes mesmo do toque)
const semEstoque = (est) => !!est && est.controlado && est.saldo <= 0


function AbaEstoque({ cervejas, setCervejas, entradas, setEntradas, consumos, perdas = [], setPerdas, onErro, onLog }) {
  const [abertoId, setAbertoId] = useState(null)
  const [vista, setVista] = useState('estoque') // 'estoque' (visão geral) | 'cadastro' | 'perdas'
  const [perdendo, setPerdendo] = useState(null) // produto sendo lançado como perda (abre modal)
  const [perdaQtd, setPerdaQtd] = useState(1)
  const [perdaMotivo, setPerdaMotivo] = useState('')
  const [buscaPerda, setBuscaPerda] = useState('')
  const [perdaDiaAberto, setPerdaDiaAberto] = useState(null) // pasta de dia aberta (YYYY-MM-DD)
  // formulário de novo produto — novoPasta guarda EM QUAL pasta estou adicionando
  // (null = form fechado). Cadastra o produto e já conta o estoque, num lugar só.
  const [novoPasta, setNovoPasta] = useState(null)
  const [nNome, setNNome] = useState('')
  const [nPreco, setNPreco] = useState('')
  const [nModo, setNModo] = useState('caixas') // 'caixas' | 'unidades'
  const [nQtd, setNQtd] = useState('')
  const [nUnid, setNUnid] = useState('') // unidades por caixa (só no modo caixas)
  const [nCusto, setNCusto] = useState('') // custo da caixa (opcional)
  const [nAviso, setNAviso] = useState('') // avisar quando saldo <= X (opcional)
  const [busca, setBusca] = useState('')
  const [pastaAberta, setPastaAberta] = useState(null) // pasta em foco (drill-down)
  const [buscaPasta, setBuscaPasta] = useState('') // busca dentro da pasta aberta
  const [subAberta, setSubAberta] = useState(null) // sub-pasta em foco (2º nível)
  const [novoSub, setNovoSub] = useState(null) // em qual sub-pasta o form está cadastrando
  const [pastasCustom, setPastasCustom] = useState([]) // pastas criadas nesta sessão
  const [subsCustom, setSubsCustom] = useState([]) // sub-pastas criadas nesta sessão
  const [ovAberto, setOvAberto] = useState(null) // card aberto na visão geral
  const [soRepor, setSoRepor] = useState(false) // filtro: só o que precisa repor
  const [nFoto, setNFoto] = useState(null) // foto escolhida no cadastro (só sobe ao salvar)
  const [nFotoPrev, setNFotoPrev] = useState('') // miniatura dela na tela
  const [salvando, setSalvando] = useState(false) // salvando produto (a foto demora)
  const [fotoSubindo, setFotoSubindo] = useState(null) // id do produto cuja foto está subindo
  const [movendo, setMovendo] = useState(null) // produto no modal de mover
  const [organizando, setOrganizando] = useState(null) // {pasta, sub, itens} sendo organizada
  const reprDe = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

  function abrirForm(pasta, sub = null) {
    setNovoPasta(pasta)
    setNovoSub(sub)
    setNNome('')
    setNPreco('')
    setNQtd('')
    setNUnid('')
    setNCusto('')
    setNAviso('')
    setNModo('caixas')
    setNFoto(null)
    setNFotoPrev('')
    setPastaAberta(pasta) // entra na pasta (e na sub-pasta) pra cadastrar dentro
    setSubAberta(sub)
  }
  // Pasta e sub-pasta recém-criadas só ENTRAM nelas — quem decide o que vem
  // depois é ele: criar mais uma sub-pasta ou cadastrar o primeiro produto.
  // (Antes caía direto no formulário e não dava pra montar a estrutura antes.)
  function novaPasta() {
    const nome = (prompt('Nome da nova pasta (ex: Castanha, Porções, Gelo):') || '').trim()
    if (!nome) return
    if (!pastasCustom.includes(nome)) setPastasCustom((p) => [...p, nome])
    setNovoPasta(null)
    setNovoSub(null)
    setPastaAberta(nome)
    setSubAberta(null)
    setBuscaPasta('')
  }
  function novaSubPasta() {
    const nome = (prompt('Nome da sub-pasta (ex: 600ml, Lata, Lata zero):') || '').trim()
    if (!nome) return
    // pasta vazia não existe no banco (o que a cria é o produto que aponta pra
    // ela), então as recém-criadas ficam guardadas aqui até ganharem o primeiro
    if (!subsCustom.some((s) => s.pasta === pastaAberta && s.sub === nome))
      setSubsCustom((s) => [...s, { pasta: pastaAberta, sub: nome }])
    setNovoPasta(null)
    setNovoSub(null)
    setSubAberta(nome)
    setBuscaPasta('')
  }

  // ---------- organizar: mover produto, pasta e sub-pasta ----------
  // Tudo passa por aqui: trocar o rótulo (`categoria`/`subcategoria`) de um
  // punhado de produtos numa tacada. Pasta vazia não existe no banco, então
  // renomear uma pasta é renomear o rótulo de todos os produtos dela.
  async function reetiquetar(itens, campos) {
    const ids = itens.map((it) => (it.c ? it.c.id : it.id))
    if (!ids.length) return true
    const { error } = await supabase.from('cervejas').update(campos).in('id', ids)
    if (error) {
      onErro('⚠️ Não consegui mover. Rodou o SQL "sub-pastas" no Supabase?')
      return false
    }
    setCervejas((cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, ...campos } : c)))
    return true
  }

  async function moverProduto(pasta, sub) {
    const c = movendo
    if (!c) return
    if (await reetiquetar([{ id: c.id }], { categoria: pasta, subcategoria: sub || null }))
      setMovendo(null)
  }

  const acoesOrganizar = {
    renomear: async () => {
      const a = organizando
      const atual = a.sub || a.pasta
      const novo = (prompt('Novo nome:', atual) || '').trim()
      if (!novo || novo === atual) return
      const ok = await reetiquetar(a.itens, a.sub ? { subcategoria: novo } : { categoria: novo })
      if (!ok) return
      if (a.sub) {
        setSubsCustom((s) => s.map((x) => (x.pasta === a.pasta && x.sub === atual ? { ...x, sub: novo } : x)))
        setSubAberta(novo)
      } else {
        setPastasCustom((p) => p.map((x) => (x === atual ? novo : x)))
        setSubsCustom((s) => s.map((x) => (x.pasta === atual ? { ...x, pasta: novo } : x)))
        setPastaAberta(novo)
      }
      setOrganizando(null)
    },
    // a sub-pasta inteira (com os produtos) muda de pasta
    moverSub: async (destino) => {
      const a = organizando
      if (!(await reetiquetar(a.itens, { categoria: destino }))) return
      setSubsCustom((s) => s.filter((x) => !(x.pasta === a.pasta && x.sub === a.sub)))
      setOrganizando(null)
      setPastaAberta(destino)
      setSubAberta(a.sub)
    },
    // a pasta vira sub-pasta de outra (é assim que se junta duas)
    pastaViraSub: async (destino) => {
      const a = organizando
      if (!(await reetiquetar(a.itens, { categoria: destino, subcategoria: a.pasta }))) return
      setPastasCustom((p) => p.filter((x) => x !== a.pasta))
      setOrganizando(null)
      setPastaAberta(destino)
      setSubAberta(a.pasta)
    },
    // a sub-pasta sobe e vira pasta de primeiro nível
    subViraPasta: async () => {
      const a = organizando
      if (!(await reetiquetar(a.itens, { categoria: a.sub, subcategoria: null }))) return
      setSubsCustom((s) => s.filter((x) => !(x.pasta === a.pasta && x.sub === a.sub)))
      setOrganizando(null)
      setPastaAberta(a.sub)
      setSubAberta(null)
    },
    // desfaz a sub-pasta: os produtos ficam soltos dentro da pasta
    dissolverSub: async () => {
      const a = organizando
      if (!confirm(`Desfazer a sub-pasta "${a.sub}"?\n\nOs ${a.itens.length} produtos ficam soltos em ${a.pasta}. Nenhum produto é apagado.`)) return
      if (!(await reetiquetar(a.itens, { subcategoria: null }))) return
      setSubsCustom((s) => s.filter((x) => !(x.pasta === a.pasta && x.sub === a.sub)))
      setOrganizando(null)
      setSubAberta(null)
    },
    // pasta vazia só existe nesta sessão: apagar é esquecer dela
    apagarVazia: () => {
      const a = organizando
      setPastasCustom((p) => p.filter((x) => x !== a.pasta))
      setSubsCustom((s) => s.filter((x) => x.pasta !== a.pasta))
      setOrganizando(null)
      setPastaAberta(null)
      setSubAberta(null)
    },
  }

  // foto escolhida no formulário: só mostra a miniatura agora; sobe no Salvar
  // (se subisse já, uma foto de produto que ele desistiu de criar ficaria órfã)
  function escolherFotoNova(file) {
    if (!file) return
    setNFoto(file)
    setNFotoPrev(URL.createObjectURL(file))
  }

  // troca a foto de um produto que já existe
  async function trocarFoto(c, file) {
    if (!file) return
    setFotoSubindo(c.id)
    try {
      const url = await subirFoto(file, c.id)
      const { error } = await supabase.from('cervejas').update({ foto: url }).eq('id', c.id)
      if (error) throw error
      setCervejas((cs) => cs.map((x) => (x.id === c.id ? { ...x, foto: url } : x)))
    } catch (_) {
      onErro('⚠️ Não consegui subir a foto. Rodou o SQL "foto-produto" no Supabase?')
    } finally {
      setFotoSubindo(null)
    }
  }

  // cria o produto (aparece na hora nas comandas e no cadastro) e, se você
  // disse quanto tem, já lança a contagem inicial — daí o saldo passa a cair sozinho.
  async function criarProduto() {
    const nome = nNome.trim()
    if (!nome) return onErro('Escreva o nome do produto.')
    const num = (v) => Number(String(v).replace(',', '.')) || 0
    const preco = num(nPreco) // preço da unidade (o que aparece na comanda)
    const qtdNum = num(nQtd)

    // unidades por caixa é uma propriedade do produto (usada no custo e na conversão)
    const unPorCaixa = nUnid.trim() ? Math.round(num(nUnid)) : null
    // converte o que chegou pra unidades (o estoque é sempre contado por unidade)
    let unidades = 0
    let caixas = null
    if (nModo === 'caixas') {
      if (qtdNum > 0) {
        if (!unPorCaixa) return onErro('Diga quantas unidades vêm na caixa.')
        caixas = qtdNum
        unidades = Math.round(qtdNum * unPorCaixa)
      }
    } else {
      unidades = Math.round(qtdNum)
    }

    const custo = nCusto.trim() ? num(nCusto) : null
    const aviso = nAviso.trim() ? Math.round(num(nAviso)) : null
    const ordem = cervejas.reduce((m, c) => Math.max(m, c.ordem ?? 0), 0) + 1
    const base = {
      nome,
      tamanho: '',
      preco,
      ordem,
      unidades_caixa: unPorCaixa,
      custo_caixa: custo,
      estoque_min: aviso,
    }
    // grava pasta e sub-pasta; se a coluna ainda não existe no banco, salva sem
    // ela (o cadastro nunca trava por causa de um SQL que não rodou).
    // A ordem importa: "subcategoria" contém "categoria", então testa ela antes.
    let res = await supabase
      .from('cervejas')
      .insert({ ...base, categoria: novoPasta, subcategoria: novoSub })
      .select()
      .single()
    if (res.error && /subcategoria/i.test(res.error.message || '')) {
      res = await supabase.from('cervejas').insert({ ...base, categoria: novoPasta }).select().single()
    }
    if (res.error && /categoria/i.test(res.error.message || '')) {
      res = await supabase.from('cervejas').insert(base).select().single()
    }
    const prod = res.data
    if (res.error || !prod) return onErro('⚠️ Não consegui salvar o produto. Tente de novo.')

    // a foto sobe depois do produto existir (o endereço dela usa o id dele).
    // Se falhar, o produto fica salvo assim mesmo — foto é o acessório, não o
    // que ele veio fazer aqui.
    let salvo = prod
    if (nFoto) {
      setSalvando(true)
      try {
        const url = await subirFoto(nFoto, prod.id)
        await supabase.from('cervejas').update({ foto: url }).eq('id', prod.id)
        salvo = { ...prod, foto: url }
      } catch (_) {
        onErro('Produto salvo, mas a foto não subiu. Dá pra tentar de novo no card dele.')
      } finally {
        setSalvando(false)
      }
    }
    setCervejas((cs) => [...cs, salvo])
    onLog?.('add_produto', `Adicionou produto: ${nome}`, { ids: [prod.id] })

    if (unidades > 0) {
      const linha = { cerveja_id: prod.id, unidades }
      if (caixas) linha.caixas = caixas
      if (custo) linha.custo_caixa = custo
      const { data: ent } = await supabase.from('estoque_entradas').insert(linha).select().single()
      if (ent) setEntradas((es) => [ent, ...es])
    }

    setNNome('')
    setNPreco('')
    setNQtd('')
    setNUnid('')
    setNCusto('')
    setNAviso('')
    setNModo('caixas')
    setNFoto(null)
    setNFotoPrev('')
    setNovoPasta(null)
    setNovoSub(null)
  }

  async function excluirProduto(c) {
    if (!confirm(`Excluir ${reprDe(c)}? Ele some das comandas e do estoque.`)) return
    const { error } = await supabase.from('cervejas').update({ ativo: false }).eq('id', c.id)
    if (error) return onErro('⚠️ Não consegui excluir. Tente de novo.')
    setCervejas((cs) => cs.filter((x) => x.id !== c.id))
    onLog?.('remover_produto', `Removeu produto: ${reprDe(c)}`, { produto: c })
  }

  // Renomear é a operação mais perigosa do app: o saldo de estoque casa a SAÍDA
  // pelo NOME do produto (consumos.beer_nome, gravado na hora da venda). Trocar
  // só o nome faria as vendas antigas pararem de descontar e o estoque subir
  // sozinho. Por isso o histórico é levado junto, na mesma ação.
  async function renomear(c) {
    const atual = reprDe(c)
    const novo = (prompt('Novo nome do produto:', atual) || '').trim()
    if (!novo || novo === atual) return
    const { error } = await supabase
      .from('cervejas')
      .update({ nome: novo, tamanho: '' })
      .eq('id', c.id)
    if (error) return onErro('⚠️ Não consegui renomear. Tente de novo.')
    // vendas e perdas passam a apontar pro nome novo (o RLS já limita à loja)
    await supabase.from('consumos').update({ beer_nome: novo }).eq('beer_nome', atual)
    await supabase.from('perdas').update({ beer_nome: novo }).eq('beer_nome', atual)
    setCervejas((cs) => cs.map((x) => (x.id === c.id ? { ...x, nome: novo, tamanho: '' } : x)))
  }

  // saldo, custo e nível de alerta de cada produto (ver calcularEstoque)
  const lista = useMemo(
    () => calcularEstoque(cervejas, entradas, consumos, perdas),
    [cervejas, entradas, consumos, perdas]
  )

  // busca por nome (quando tem texto, ignora as pastas e mostra tudo que casa)
  const listaFiltrada = useMemo(() => {
    const q = normalizar(busca)
    if (!q) return lista
    return lista.filter((it) => normalizar(reprDe(it.c)).includes(q))
  }, [lista, busca])

  // pastas por label (as que têm produto + as criadas na sessão), com alertas
  const pastas = useMemo(
    () =>
      agruparEmPastas(lista, (it) => it.c, pastasCustom).map((p) => ({
        ...p,
        alertas: p.itens.filter((i) => i.nivel === 'zero' || i.nivel === 'baixo').length,
      })),
    [lista, pastasCustom]
  )

  async function salvarCampo(c, campo, valor) {
    const txt = String(valor).trim()
    const v = txt === '' ? null : Number(txt.replace(',', '.'))
    if (v !== null && (isNaN(v) || v < 0)) return
    const { error } = await supabase.from('cervejas').update({ [campo]: v }).eq('id', c.id)
    if (error) return onErro('⚠️ Não salvou. Tente de novo.')
    setCervejas((cs) => cs.map((x) => (x.id === c.id ? { ...x, [campo]: v } : x)))
  }

  async function abastecer(c, modo, valor) {
    const num = Number(String(valor).replace(',', '.')) || 0
    let unidades = 0
    let caixas = null
    if (modo === 'caixas') {
      const upc = Number(c.unidades_caixa) || 0
      if (!upc) return onErro('Defina "unid. por caixa" antes de abastecer por caixa.')
      caixas = num
      unidades = Math.round(num * upc)
    } else {
      unidades = Math.round(num)
    }
    if (unidades <= 0) return onErro('Quantas unidades entraram?')
    const linha = { cerveja_id: c.id, unidades }
    if (caixas) linha.caixas = caixas
    if (c.custo_caixa) linha.custo_caixa = Number(c.custo_caixa)
    const { data, error } = await supabase
      .from('estoque_entradas')
      .insert(linha)
      .select()
      .single()
    if (error || !data) return onErro('⚠️ Não registrou a entrada. Tente de novo.')
    setEntradas((es) => [data, ...es])
  }

  async function removerEntrada(id) {
    // O saldo só desconta as vendas que aconteceram DEPOIS da primeira entrada
    // do produto — ela é o marco zero da contagem. Apagando justo a mais antiga,
    // o marco pula pra frente e as vendas que ficaram atrás param de descontar:
    // o saldo SOBE em vez de "voltar ao que era". Só avisa quando é esse caso.
    const alvo = entradas.find((e) => e.id === id)
    const outras = alvo
      ? entradas.filter((e) => e.cerveja_id === alvo.cerveja_id && e.id !== id)
      : []
    const ehAPrimeira =
      alvo &&
      outras.length > 0 &&
      outras.every((e) => new Date(e.created_at) > new Date(alvo.created_at))
    const pergunta = ehAPrimeira
      ? 'Apagar essa entrada?\n\n⚠️ ATENÇÃO: ela é a PRIMEIRA contagem deste produto.\n\n' +
        'A contagem começa a valer dela pra frente. Apagando, as vendas que ' +
        'aconteceram antes das outras entradas param de descontar e o saldo pode ' +
        'SUBIR em vez de voltar ao que era.\n\nTem certeza?'
      : 'Apagar essa entrada? O saldo volta ao que era.'
    if (!confirm(pergunta)) return
    const { error } = await supabase.from('estoque_entradas').delete().eq('id', id)
    if (error) return onErro('⚠️ Não consegui apagar. Tente de novo.')
    setEntradas((es) => es.filter((e) => e.id !== id))
  }

  // registra uma perda (quebra/vencimento): sai do estoque na hora e vai pro Relatório
  async function registrarPerda() {
    if (!perdendo || !setPerdas) return
    const c = perdendo
    const qtd = Math.max(1, Math.round(perdaQtd))
    const linha = {
      cerveja_id: c.id,
      beer_nome: reprDe(c),
      preco_unit: Number(c.preco) || 0,
      quantidade: qtd,
      motivo: perdaMotivo || null,
    }
    const { data, error } = await supabase.from('perdas').insert(linha).select().single()
    if (error || !data) return onErro('⚠️ Não registrei a perda. Rodou o perdas.sql no Supabase?')
    setPerdas((ps) => [data, ...ps])
    // registra também no Histórico (pasta Perdas) — dá pra desfazer por lá
    onLog?.('perda', `Perda: ${qtd}× ${reprDe(c)}${perdaMotivo ? ` (${perdaMotivo})` : ''}`, { id: data.id })
    setPerdendo(null)
    setPerdaQtd(1)
    setPerdaMotivo('')
  }

  async function removerPerda(id) {
    if (!confirm('Apagar essa perda? O item volta pro estoque.')) return
    const { error } = await supabase.from('perdas').delete().eq('id', id)
    if (error) return onErro('⚠️ Não consegui apagar. Tente de novo.')
    setPerdas((ps) => ps.filter((p) => p.id !== id))
  }

  const renderCard = (it) => (
    <EstoqueCard
      key={it.c.id}
      it={it}
      aberto={abertoId === it.c.id}
      onAbrir={() => setAbertoId((id) => (id === it.c.id ? null : it.c.id))}
      onCampo={salvarCampo}
      onAbastecer={abastecer}
      onRemoverEntrada={removerEntrada}
      onExcluir={() => excluirProduto(it.c)}
      onRenomear={() => renomear(it.c)}
      onMover={() => setMovendo(it.c)}
      onFoto={trocarFoto}
      subindoFoto={fotoSubindo === it.c.id}
    />
  )

  // formulário de novo produto (aparece dentro da pasta que você escolheu)
  const renderForm = () => (
    <div className="est-novo">
      <input
        className="campo"
        placeholder="Nome do produto (ex: Original 600)"
        value={nNome}
        onChange={(e) => setNNome(e.target.value)}
      />

      <span className="est-novo-lbl">Quanto chegou agora</span>
      <div className="est-novo-qtd">
        <input
          className="campo est-novo-q"
          placeholder={nModo === 'caixas' ? 'nº de caixas' : 'nº de unidades'}
          type="number"
          inputMode="numeric"
          value={nQtd}
          onChange={(e) => setNQtd(e.target.value)}
        />
        <div className="est-modo">
          <button className={nModo === 'caixas' ? 'on' : ''} onClick={() => setNModo('caixas')}>
            Caixas
          </button>
          <button className={nModo === 'unidades' ? 'on' : ''} onClick={() => setNModo('unidades')}>
            Unidades
          </button>
        </div>
      </div>

      <label className="est-novo-linha">
        <span>Quantos custou essa caixa?</span>
        <div className="prod-preco">
          <span>R$</span>
          <input
            className="campo"
            placeholder="0,00"
            type="number"
            step="0.50"
            inputMode="decimal"
            value={nCusto}
            onChange={(e) => setNCusto(e.target.value)}
          />
        </div>
      </label>
      <label className="est-novo-linha">
        <span>Quantas unidades vem na caixa?</span>
        <input
          className="campo est-novo-num"
          placeholder="ex: 12"
          type="number"
          inputMode="numeric"
          value={nUnid}
          onChange={(e) => setNUnid(e.target.value)}
        />
      </label>
      <label className="est-novo-linha">
        <span>Vai vender por quantos a unidade?</span>
        <div className="prod-preco">
          <span>R$</span>
          <input
            className="campo"
            placeholder="0,00"
            type="number"
            step="0.50"
            inputMode="decimal"
            value={nPreco}
            onChange={(e) => setNPreco(e.target.value)}
          />
        </div>
      </label>
      <label className="est-novo-linha">
        <span>Vou avisar quando o estoque estiver com</span>
        <input
          className="campo est-novo-num"
          placeholder="ex: 12"
          type="number"
          inputMode="numeric"
          value={nAviso}
          onChange={(e) => setNAviso(e.target.value)}
        />
      </label>

      {/* sem `capture`: assim o celular deixa escolher entre a câmera e a galeria */}
      <label className="est-novo-linha est-foto-linha">
        <span>Foto do produto</span>
        <span className="est-foto-esc">
          {nFotoPrev ? (
            <img src={nFotoPrev} alt="" />
          ) : (
            <span className="est-foto-txt">📷 Tirar ou escolher</span>
          )}
          <input type="file" accept="image/*" onChange={(e) => escolherFotoNova(e.target.files?.[0])} />
        </span>
      </label>

      <div className="est-novo-acoes">
        <button className="btn-grande" onClick={criarProduto} disabled={salvando}>
          {salvando ? 'Salvando…' : '✓ Salvar'}
        </button>
        <button className="est-cancelar" onClick={() => { setNovoPasta(null); setNovoSub(null) }}>
          Cancelar
        </button>
      </div>
    </div>
  )

  // os dois modais de organização aparecem em qualquer tela do Estoque
  const modais = (
    <>
      {movendo && (
        <MoverProduto
          produto={movendo}
          pastas={pastas}
          onMover={moverProduto}
          onFechar={() => setMovendo(null)}
        />
      )}
      {organizando && (
        <OrganizarPasta
          alvo={organizando}
          pastas={pastas}
          acoes={acoesOrganizar}
          onFechar={() => setOrganizando(null)}
        />
      )}
    </>
  )

  const pastaFoco = pastaAberta ? pastas.find((p) => p.label === pastaAberta) : null
  // dentro da pasta: as sub-pastas dela e os produtos que não estão em nenhuma
  const { subs: subsComItens, soltos } = pastaFoco
    ? dividirEmSubPastas(pastaFoco.itens, (it) => it.c)
    : { subs: [], soltos: [] }
  // + as recém-criadas, que ainda não têm produto (só existem nesta sessão)
  const subs = [...subsComItens]
  for (const s of subsCustom)
    if (s.pasta === pastaAberta && !subs.some((x) => x.label === s.sub))
      subs.push({ label: s.sub, icone: iconeSub(s.sub), itens: [] })
  const subFoco = subAberta ? subs.find((s) => s.label === subAberta) : null
  // a busca varre o nível em que você está (a pasta inteira ou só a sub-pasta)
  const itensFoco = subFoco ? subFoco.itens : pastaFoco ? pastaFoco.itens : []
  const itensFocoVis = buscaPasta.trim()
    ? itensFoco.filter((it) => casaProduto(it.c, normalizar(buscaPasta)))
    : itensFoco
  const nivel = subFoco || (pastaFoco && { label: pastaAberta, icone: iconePasta(pastaAberta) })

  if (pastaAberta) {
    // ---------- DETALHE: a pasta escolhida (e, dentro dela, a sub-pasta) ----------
    return (
      <main className="conteudo">
        <div className="est-nav">
          <button
            className="est-voltar"
            onClick={() => {
              // de dentro da sub-pasta volta pra pasta; da pasta volta pra lista
              if (subAberta) setSubAberta(null)
              else setPastaAberta(null)
              setNovoPasta(null)
              setNovoSub(null)
              setBuscaPasta('')
            }}
          >
            ‹ Voltar
          </button>
          <span className="est-nav-tit">
            {nivel ? `${nivel.icone} ${nivel.label}` : ''}
          </span>
          <button
            className="est-org"
            onClick={() =>
              setOrganizando({ pasta: pastaAberta, sub: subAberta || null, itens: itensFoco })
            }
            aria-label="Organizar pasta"
          >
            ⚙️
          </button>
        </div>

        {itensFoco.length > 5 && (
          <div className="busca-wrap est-busca">
            <input
              className="campo busca"
              placeholder={`🔎 Buscar em ${subAberta || pastaAberta}…`}
              value={buscaPasta}
              onChange={(e) => setBuscaPasta(e.target.value)}
            />
            {buscaPasta && (
              <button
                className="busca-x"
                onClick={() => setBuscaPasta('')}
                aria-label="Limpar busca"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* sub-pastas: só no primeiro nível e quando não está buscando */}
        {!subFoco && !buscaPasta.trim() && subs.length > 0 && (
          <div className="est-folders est-subs">
            {subs.map((s) => {
              const alerta = s.itens.filter((i) => i.nivel === 'zero' || i.nivel === 'baixo').length
              return (
                <button key={s.label} className="est-folder" onClick={() => setSubAberta(s.label)}>
                  <span className="est-folder-ic">{s.icone}</span>
                  <div className="est-folder-txt">
                    <span className="est-folder-nome">{s.label}</span>
                    <span className="est-folder-sub">
                      {s.itens.length} produto{s.itens.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {alerta > 0 && (
                    <span className="est-pasta-alerta">
                      {alerta} baixo{alerta > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="est-folder-seta">›</span>
                </button>
              )
            })}
          </div>
        )}

        {(() => {
          // buscando: mostra o que achou. Na sub-pasta: os produtos dela.
          // Na pasta: só os que NÃO estão em sub-pasta (o resto está nos cartões).
          const mostrar = buscaPasta.trim() ? itensFocoVis : subFoco ? subFoco.itens : soltos
          return mostrar.length > 0 ? <div className="est-lista">{mostrar.map(renderCard)}</div> : null
        })()}

        {itensFoco.length > 0 && buscaPasta.trim() && itensFocoVis.length === 0 && (
          <p className="est-pasta-vazia">
            Nenhum produto com “{buscaPasta}” nessa pasta.
          </p>
        )}
        {itensFoco.length === 0 && (subFoco || subs.length === 0) && novoPasta !== pastaAberta && (
          <p className="est-pasta-vazia">
            {subAberta
              ? 'Sub-pasta vazia — adicione o primeiro produto.'
              : 'Pasta vazia — crie uma sub-pasta ou adicione o primeiro produto.'}
          </p>
        )}

        {novoPasta === pastaAberta && novoSub === (subAberta || null) ? (
          renderForm()
        ) : (
          <>
            <button
              className="est-add-pasta"
              onClick={() => abrirForm(pastaAberta, subAberta || null)}
            >
              + Adicionar produto{subAberta ? ` em ${subAberta}` : ''}
            </button>
            {!subFoco && (
              <button className="est-novo-btn" onClick={novaSubPasta}>
                + Nova sub-pasta
              </button>
            )}
          </>
        )}
        {modais}
      </main>
    )
  }

  // ---------- TOPO: Meu estoque (visão geral) | Cadastrar | Perdas ----------
  // A lista já vem na ordem que importa: acabou primeiro, acabando depois, o
  // que está em estoque lá embaixo (ver o `rank` em `lista`). O filtro corta
  // fora tudo que não precisa de compra.
  const precisaRepor = (i) => i.nivel === 'zero' || i.nivel === 'baixo'
  const overviewBase = busca.trim() ? listaFiltrada : lista
  const overviewRows = soRepor ? overviewBase.filter(precisaRepor) : overviewBase
  const nRepor = lista.filter(precisaRepor).length
  const totalUn = lista.reduce((s, it) => s + (it.controlado ? it.saldo : 0), 0)
  const statusLabel = (n) =>
    ({ zero: 'Acabou', baixo: 'Acabando', ok: 'Em estoque', novo: 'Sem contagem' }[n] || '')

  // aba Perdas: lista de produtos pra escolher + totais do que já se perdeu
  const qPerda = normalizar(buscaPerda)
  const perdaFiltrados = qPerda ? cervejas.filter((c) => normalizar(reprDe(c)).includes(qPerda)) : cervejas
  const totalPerdidas = perdas.reduce((s, p) => s + (p.quantidade || 0), 0)
  const valorPerdido = perdas.reduce((s, p) => s + Number(p.preco_unit || 0) * (p.quantidade || 0), 0)
  const horaPerda = (ts) =>
    new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const chaveDia = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const rotuloDia = (key) => {
    const hoje = new Date()
    const ontem = new Date()
    ontem.setDate(ontem.getDate() - 1)
    if (key === chaveDia(hoje)) return 'Hoje'
    if (key === chaveDia(ontem)) return 'Ontem'
    const [y, mo, da] = key.split('-')
    return `${da}/${mo}/${y}`
  }
  // perdas agrupadas por dia (a lista já vem mais nova primeiro → dias em ordem)
  const perdasPorDia = []
  {
    const idx = new Map()
    for (const p of perdas) {
      const key = chaveDia(new Date(p.created_at))
      let g = idx.get(key)
      if (!g) {
        g = { dia: key, itens: [], qtd: 0, valor: 0 }
        idx.set(key, g)
        perdasPorDia.push(g)
      }
      g.itens.push(p)
      g.qtd += p.quantidade
      g.valor += Number(p.preco_unit) * p.quantidade
    }
  }
  const diaFoco = perdaDiaAberto ? perdasPorDia.find((g) => g.dia === perdaDiaAberto) : null

  return (
    <main className="conteudo">
      <div className="est-vista">
        <button
          className={vista === 'estoque' ? 'on' : ''}
          onClick={() => setVista('estoque')}
        >
          📊 Meu estoque
        </button>
        <button
          className={vista === 'cadastro' ? 'on' : ''}
          onClick={() => setVista('cadastro')}
        >
          ✏️ Cadastrar
        </button>
        <button
          className={vista === 'perdas' ? 'on' : ''}
          onClick={() => setVista('perdas')}
        >
          🗑️ Perdas
        </button>
      </div>

      {cervejas.length > 3 && vista !== 'perdas' && (
        <div className="busca-wrap est-busca">
          <input
            className="campo busca"
            placeholder="🔎 Buscar produto…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <button
              className="busca-x"
              onClick={() => setBusca('')}
              aria-label="Limpar busca"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {vista === 'estoque' ? (
        // ---------- VISÃO GERAL ----------
        cervejas.length === 0 ? (
          <p className="vazio">
            Nenhum produto ainda. Toque em <b>✏️ Cadastrar</b> pra começar.
          </p>
        ) : (
          <>
            {!busca.trim() && (
              <div className="est-vg-resumo">
                <div>
                  <b>{lista.length}</b>
                  <span>produtos</span>
                </div>
                {/* o "pra repor" é o número que ele age em cima: vira filtro */}
                <button
                  className={
                    'est-vg-btn' + (nRepor > 0 ? ' est-vg-repor' : '') + (soRepor ? ' on' : '')
                  }
                  onClick={() => setSoRepor((v) => !v)}
                  disabled={nRepor === 0}
                >
                  <b>{nRepor}</b>
                  <span>{soRepor ? 'vendo só estes ✕' : 'pra repor'}</span>
                </button>
                <div>
                  <b>{totalUn}</b>
                  <span>unidades</span>
                </div>
              </div>
            )}
            {overviewRows.length === 0 ? (
              <p className="vazio">
                {soRepor ? 'Nada pra repor. 👍' : 'Nenhum produto com esse nome.'}
              </p>
            ) : (
              <div className="est-ov-lista">
                {overviewRows.map((it) => {
                  const upc = Number(it.c.unidades_caixa) || 0
                  const cx = upc > 0 ? Math.floor(it.saldo / upc) : 0
                  const resto = upc > 0 ? it.saldo % upc : 0
                  const caixaTxt =
                    upc > 0
                      ? cx > 0
                        ? `${cx} cx${resto > 0 ? ` + ${resto} un` : ''}`
                        : `${resto} un`
                      : null
                  const valor = it.saldo * (Number(it.c.preco) || 0)
                  const aberto = ovAberto === it.c.id
                  return (
                    <div key={it.c.id} className={'est-ov-card est-ovc-' + it.nivel}>
                      {/* primeira visão: só o que interessa de longe */}
                      <button
                        className="est-ov-top"
                        onClick={() => setOvAberto((id) => (id === it.c.id ? null : it.c.id))}
                      >
                        <span className={'est-vg-status est-' + it.nivel} />
                        {it.c.foto && (
                          <img
                            className="est-ov-foto"
                            src={it.c.foto}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                          />
                        )}
                        <div className="est-ov-id">
                          <span className="est-ov-nome">{reprDe(it.c)}</span>
                          <span className={'est-ov-tag est-' + it.nivel}>
                            {statusLabel(it.nivel)}
                          </span>
                        </div>
                        <div className="est-ov-saldo-wrap">
                          <b className={'est-ov-saldo est-' + it.nivel}>
                            {it.controlado ? it.saldo : '—'}
                          </b>
                          <small>un.</small>
                        </div>
                        <span className="est-ov-seta">{aberto ? '▾' : '›'}</span>
                      </button>

                      {/* o resto só quando ele pede */}
                      {aberto &&
                        (it.controlado ? (
                          <div className="est-ov-stats">
                            {caixaTxt && <span className="est-ov-chip">📦 {caixaTxt}</span>}
                            <span className="est-ov-chip">📥 entrou {it.entrou}</span>
                            <span className="est-ov-chip">📤 saiu {it.saiu}</span>
                            {it.perdidas > 0 && (
                              <span className="est-ov-chip est-ov-chip-perda">🗑️ perdas {it.perdidas}</span>
                            )}
                            {Number(it.c.preco) > 0 && (
                              <span className="est-ov-chip">🏷️ {money(it.c.preco)}</span>
                            )}
                            {valor > 0 && (
                              <span className="est-ov-chip est-ov-chip-forte">
                                💰 {money(valor)} em estoque
                              </span>
                            )}
                            {it.min > 0 && (
                              <span className="est-ov-chip">🔔 avisa ≤ {it.min}</span>
                            )}
                          </div>
                        ) : (
                          <p className="est-ov-semctrl">
                            Sem contagem — faça no <b>✏️ Cadastrar</b>
                          </p>
                        ))}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
      ) : vista === 'perdas' ? (
        // ---------- PERDAS (quebra / vencimento / estrago) ----------
        <>
          <p className="perda-dica">
            O que quebrou, venceu ou estragou fica registrado aqui — por dia, pra ter controle.
          </p>

          {cervejas.length > 3 && (
            <div className="busca-wrap est-busca">
              <input
                className="campo busca"
                placeholder="🔎 Qual produto se perdeu?"
                value={buscaPerda}
                onChange={(e) => setBuscaPerda(e.target.value)}
              />
              {buscaPerda && (
                <button className="busca-x" onClick={() => setBuscaPerda('')} aria-label="Limpar busca">
                  ✕
                </button>
              )}
            </div>
          )}

          <h3 className="sec">🗑️ Perdas registradas</h3>
          {perdas.length === 0 ? (
            <p className="vazio">Nenhuma perda registrada. 👍</p>
          ) : diaFoco ? (
            // ---- dentro da pasta de um dia ----
            <>
              <div className="est-nav">
                <button className="est-voltar" onClick={() => setPerdaDiaAberto(null)}>
                  ‹ Voltar
                </button>
                <span className="est-nav-tit">📅 {rotuloDia(diaFoco.dia)}</span>
              </div>
              <div className="perda-total">
                <span>
                  {diaFoco.qtd} {diaFoco.qtd === 1 ? 'item perdido' : 'itens perdidos'}
                </span>
                {diaFoco.valor > 0 && <b>{money(diaFoco.valor)}</b>}
              </div>
              <div className="perda-lista">
                {diaFoco.itens.map((p) => (
                  <div key={p.id} className="perda-linha">
                    <div className="perda-linha-txt">
                      <span className="perda-linha-nome">
                        {p.quantidade}× {p.beer_nome}
                      </span>
                      <span className="perda-linha-sub">
                        🕐 {horaPerda(p.created_at)}
                        {p.motivo ? ` · ${p.motivo}` : ''}
                      </span>
                    </div>
                    {Number(p.preco_unit) > 0 && (
                      <span className="perda-linha-val">{money(p.preco_unit * p.quantidade)}</span>
                    )}
                    <button
                      className="est-card-x"
                      onClick={() => removerPerda(p.id)}
                      aria-label="Apagar perda"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            // ---- pastas por dia ----
            <>
              <div className="perda-total">
                <span>
                  {totalPerdidas} {totalPerdidas === 1 ? 'item perdido' : 'itens perdidos'} ·{' '}
                  {perdasPorDia.length} {perdasPorDia.length === 1 ? 'dia' : 'dias'}
                </span>
                {valorPerdido > 0 && <b>{money(valorPerdido)}</b>}
              </div>
              <div className="est-folders">
                {perdasPorDia.map((g) => (
                  <button
                    key={g.dia}
                    className="est-folder"
                    onClick={() => setPerdaDiaAberto(g.dia)}
                  >
                    <span className="est-folder-ic">📅</span>
                    <div className="est-folder-txt">
                      <span className="est-folder-nome">{rotuloDia(g.dia)}</span>
                      <span className="est-folder-sub">
                        {g.qtd} {g.qtd === 1 ? 'item' : 'itens'}
                        {g.valor > 0 ? ` · ${money(g.valor)}` : ''}
                      </span>
                    </div>
                    <span className="est-folder-seta">›</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <h3 className="sec">➕ Registrar uma perda</h3>
          <p className="perda-dica">Toque no produto — ele sai do estoque na hora.</p>
          <div className="perda-prods">
            {perdaFiltrados.length === 0 && <p className="vazio">Nenhum produto com esse nome.</p>}
            {perdaFiltrados.map((c) => (
              <button
                key={c.id}
                className="perda-prod"
                onClick={() => {
                  setPerdendo(c)
                  setPerdaQtd(1)
                  setPerdaMotivo('')
                }}
              >
                {c.foto && (
                  <img
                    className="est-cab-foto"
                    src={c.foto}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <span className="perda-prod-nome">{reprDe(c)}</span>
                <span className="perda-prod-add">− estoque</span>
              </button>
            ))}
          </div>

          {perdendo && (
            <div className="pag-overlay" onClick={() => setPerdendo(null)}>
              <div className="pag-box perda-box" onClick={(e) => e.stopPropagation()}>
                <button className="modal-x" onClick={() => setPerdendo(null)} aria-label="Fechar">
                  ✕
                </button>
                <div className="perda-box-prod">
                  {perdendo.foto && (
                    <img className="est-cab-foto" src={perdendo.foto} alt="" />
                  )}
                  <strong>{reprDe(perdendo)}</strong>
                </div>

                <span className="perda-box-lbl">Quantas unidades se perderam?</span>
                <div className="md-step perda-step">
                  <button onClick={() => setPerdaQtd((n) => Math.max(1, n - 1))} disabled={perdaQtd <= 1}>
                    −
                  </button>
                  <strong>{perdaQtd}</strong>
                  <button onClick={() => setPerdaQtd((n) => n + 1)}>+</button>
                </div>

                <span className="perda-box-lbl">Motivo (opcional)</span>
                <div className="perda-motivos">
                  {['Quebrou', 'Venceu', 'Estragou', 'Cortesia', 'Outro'].map((m) => (
                    <button
                      key={m}
                      className={'perda-mot' + (perdaMotivo === m ? ' on' : '')}
                      onClick={() => setPerdaMotivo((v) => (v === m ? '' : m))}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <button className="btn-grande perda-confirm" onClick={registrarPerda}>
                  🗑️ Registrar perda ({perdaQtd})
                </button>
              </div>
            </div>
          )}
        </>
      ) : // ---------- CADASTRAR ----------
      busca.trim() ? (
        <div className="est-lista">
          {listaFiltrada.length === 0 && (
            <p className="vazio">Nenhum produto com esse nome.</p>
          )}
          {listaFiltrada.map(renderCard)}
        </div>
      ) : (
        <>
          <button className="est-novo-btn" onClick={novaPasta}>
            + Nova pasta
          </button>
          {pastas.length === 0 ? (
            <p className="vazio">
              Ainda sem produtos. Crie uma <b>pasta</b> (ex: Cerveja) e adicione os
              produtos dentro dela.
            </p>
          ) : (
            <div className="est-folders">
              {pastas.map((p) => (
                <button
                  key={p.label}
                  className="est-folder"
                  onClick={() => setPastaAberta(p.label)}
                >
                  <span className="est-folder-ic">{p.icone}</span>
                  <div className="est-folder-txt">
                    <span className="est-folder-nome">{p.label}</span>
                    <span className="est-folder-sub">
                      {p.itens.length} produto{p.itens.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {p.alertas > 0 && (
                    <span className="est-pasta-alerta">
                      {p.alertas} baixo{p.alertas > 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="est-folder-seta">›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {modais}
    </main>
  )
}

// ===================== Organizar o catálogo =====================
// Pasta não é registro no banco: é o rótulo que o produto carrega (`categoria`
// e `subcategoria`). Então mover, renomear e juntar são a MESMA operação —
// trocar esse rótulo num punhado de produtos de uma vez. É isso que deixa o
// lojista reorganizar tudo sozinho, sem depender de SQL.

function MoverProduto({ produto, pastas, onMover, onFechar }) {
  const [pasta, setPasta] = useState(pastaDe(produto))
  const [sub, setSub] = useState(subPastaDe(produto))

  const daPasta = pastas.find((p) => p.label === pasta)
  const subs = daPasta ? dividirEmSubPastas(daPasta.itens, (it) => it.c).subs.map((s) => s.label) : []

  return (
    <div className="pag-overlay" onClick={onFechar}>
      <div className="pag-box org-box" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onFechar} aria-label="Fechar">
          ✕
        </button>
        <p className="pag-titulo">📁 Mover produto</p>
        <strong className="org-alvo">{produto.nome}</strong>

        <span className="org-lbl">Pasta</span>
        <div className="chips">
          {pastas.map((p) => (
            <button
              key={p.label}
              className={'chip' + (pasta === p.label ? ' on' : '')}
              onClick={() => {
                setPasta(p.label)
                setSub(null) // sub-pasta é de outra pasta: não vem junto
              }}
            >
              {p.icone} {p.label}
            </button>
          ))}
          <button
            className="chip chip-novo"
            onClick={() => {
              const n = (prompt('Nome da nova pasta:') || '').trim()
              if (!n) return
              setPasta(n)
              setSub(null)
            }}
          >
            + Nova
          </button>
        </div>

        <span className="org-lbl">Sub-pasta</span>
        <div className="chips">
          <button className={'chip' + (!sub ? ' on' : '')} onClick={() => setSub(null)}>
            — nenhuma
          </button>
          {subs.map((s) => (
            <button
              key={s}
              className={'chip' + (sub === s ? ' on' : '')}
              onClick={() => setSub(s)}
            >
              {iconeSub(s)} {s}
            </button>
          ))}
          <button
            className="chip chip-novo"
            onClick={() => {
              const n = (prompt('Nome da nova sub-pasta:') || '').trim()
              if (n) setSub(n)
            }}
          >
            + Nova
          </button>
        </div>

        <button className="pag-confirmar" onClick={() => onMover(pasta, sub)}>
          ✓ Mover pra {pasta}
          {sub ? ' › ' + sub : ''}
        </button>
        <button className="pag-cancelar" onClick={onFechar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

function OrganizarPasta({ alvo, pastas, acoes, onFechar }) {
  const [escolhendo, setEscolhendo] = useState(null) // 'mover' | 'virarSub'
  const ehSub = !!alvo.sub
  const nome = ehSub ? alvo.sub : alvo.pasta
  const qtd = alvo.itens.length
  const temSubs = !ehSub && dividirEmSubPastas(alvo.itens, (it) => it.c).subs.length > 0
  const destinos = pastas.filter((p) => p.label !== alvo.pasta)

  if (escolhendo) {
    return (
      <div className="pag-overlay" onClick={onFechar}>
        <div className="pag-box org-box" onClick={(e) => e.stopPropagation()}>
          <p className="pag-titulo">
            {escolhendo === 'mover' ? 'Mover pra qual pasta?' : 'Ficar dentro de qual pasta?'}
          </p>
          <div className="chips">
            {destinos.map((p) => (
              <button
                key={p.label}
                className="chip"
                onClick={() =>
                  escolhendo === 'mover' ? acoes.moverSub(p.label) : acoes.pastaViraSub(p.label)
                }
              >
                {p.icone} {p.label}
              </button>
            ))}
            <button
              className="chip chip-novo"
              onClick={() => {
                const n = (prompt('Nome da nova pasta:') || '').trim()
                if (!n) return
                escolhendo === 'mover' ? acoes.moverSub(n) : acoes.pastaViraSub(n)
              }}
            >
              + Nova
            </button>
          </div>
          <button className="pag-cancelar" onClick={() => setEscolhendo(null)}>
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pag-overlay" onClick={onFechar}>
      <div className="pag-box org-box" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onFechar} aria-label="Fechar">
          ✕
        </button>
        <p className="pag-titulo">⚙️ Organizar {ehSub ? 'sub-pasta' : 'pasta'}</p>
        <strong className="org-alvo">{nome}</strong>
        <span className="org-sub">
          {qtd} produto{qtd === 1 ? '' : 's'}
          {temSubs ? ' · tem sub-pastas' : ''}
        </span>

        <button className="org-acao" onClick={acoes.renomear}>
          ✏️ Renomear
        </button>

        {ehSub ? (
          <>
            <button className="org-acao" onClick={() => setEscolhendo('mover')}>
              📁 Mover pra outra pasta
            </button>
            <button className="org-acao" onClick={acoes.subViraPasta}>
              ⬆️ Virar pasta (sair de {alvo.pasta})
            </button>
            <button className="org-acao" onClick={acoes.dissolverSub}>
              🗑️ Desfazer a sub-pasta
              <small>os produtos ficam soltos em {alvo.pasta}</small>
            </button>
          </>
        ) : (
          <>
            <button
              className="org-acao"
              onClick={() => setEscolhendo('virarSub')}
              disabled={temSubs}
            >
              ⬇️ Virar sub-pasta de outra pasta
              {temSubs && <small>não dá: esta pasta já tem sub-pastas dentro</small>}
            </button>
            <button className="org-acao" onClick={acoes.apagarVazia} disabled={qtd > 0}>
              🗑️ Apagar a pasta
              {qtd > 0 && <small>tire os {qtd} produtos daqui primeiro</small>}
            </button>
          </>
        )}

        <button className="pag-cancelar" onClick={onFechar}>
          Fechar
        </button>
      </div>
    </div>
  )
}

function EstoqueCard({ it, aberto, onAbrir, onCampo, onAbastecer, onRemoverEntrada, onExcluir, onRenomear, onMover, onFoto, subindoFoto }) {
  const { c, controlado, entrou, saiu, saldo, custoUnit, nivel, ents } = it
  // começa em "unidades" enquanto não houver unid/caixa (assim o 1º uso — a
  // contagem inicial — funciona na hora); com caixa configurada, vai pra "caixas"
  const [modo, setModo] = useState(c.unidades_caixa ? 'caixas' : 'unidades')
  const [qtd, setQtd] = useState('')
  const reprDe = (x) => (x.tamanho ? `${x.nome} ${x.tamanho}` : x.nome)
  const num = (v) => Number(String(v).replace(',', '.')) || 0
  const unPorCaixa = Number(c.unidades_caixa) || 0

  const badge =
    nivel === 'novo'
      ? { txt: 'sem controle', cls: 'est-semctrl' }
      : nivel === 'zero'
      ? { txt: 'esgotado', cls: 'est-zero' }
      : nivel === 'baixo'
      ? { txt: 'estoque baixo', cls: 'est-baixo' }
      : { txt: 'ok', cls: 'est-ok' }

  function registrar() {
    if (!qtd) return
    onAbastecer(c, modo, qtd)
    setQtd('')
  }

  return (
    <div className={'est-card ' + badge.cls + (aberto ? ' on' : '')}>
      <div className="est-cab-row">
        <button className="est-cab" onClick={onAbrir}>
          {c.foto && (
            <img
              className="est-cab-foto"
              src={c.foto}
              alt=""
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className="est-cab-txt">
            <span className="est-nome">{reprDe(c)}</span>
            <span className={'est-badge ' + badge.cls}>{badge.txt}</span>
          </div>
          <div className="est-saldo">
            {controlado ? (
              <>
                <strong>{saldo}</strong>
                <span>un.</span>
              </>
            ) : (
              <span className="est-saldo-vazio">—</span>
            )}
          </div>
        </button>
        <button className="est-card-x" onClick={onRenomear} aria-label="Renomear produto">
          ✏️
        </button>
        {onMover && (
          <button className="est-card-x" onClick={onMover} aria-label="Mover de pasta">
            📁
          </button>
        )}
        <button className="est-card-x" onClick={onExcluir} aria-label="Excluir produto">
          ✕
        </button>
      </div>

      {aberto && (
        <div className="est-corpo">
          {/* ---- Chegou mercadoria / contagem (ação principal) ---- */}
          <div className="est-secao">
            <span className="est-secao-tit">
              📥 {controlado ? 'Chegou mais mercadoria?' : 'Contar o que tem hoje'}
            </span>
            <div className="est-abastecer">
              <div className="est-modo">
                <button
                  className={modo === 'caixas' ? 'on' : ''}
                  onClick={() => setModo('caixas')}
                >
                  Caixas
                </button>
                <button
                  className={modo === 'unidades' ? 'on' : ''}
                  onClick={() => setModo('unidades')}
                >
                  Unidades
                </button>
              </div>
              <input
                className="est-qtd"
                type="number"
                step="1"
                inputMode="numeric"
                placeholder={modo === 'caixas' ? 'nº de caixas' : 'nº de unidades'}
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && registrar()}
              />
              <button className="est-add" onClick={registrar}>
                {controlado ? '+ Entrada' : '✓ Contar'}
              </button>
            </div>
            {modo === 'caixas' && unPorCaixa > 0 && num(qtd) > 0 && (
              <p className="est-preview">
                = <b>{Math.round(num(qtd) * unPorCaixa)} unidades</b> ({qtd} × {unPorCaixa} por caixa)
              </p>
            )}
            {modo === 'caixas' && unPorCaixa === 0 && (
              <p className="est-preview est-preview-aviso">
                Preencha “Unid. por caixa” aqui embaixo pra somar por caixa.
              </p>
            )}
            {!controlado && (
              <p className="est-dica">
                Conte o que tem no estoque agora. A partir daí cada venda desconta sozinho.
              </p>
            )}
          </div>

          {/* ---- Foto ---- */}
          {onFoto && (
            <div className="est-secao">
              <span className="est-secao-tit">📷 Foto do produto</span>
              <label className="est-foto-troca">
                {c.foto ? (
                  <img src={c.foto} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                ) : (
                  <span className="est-foto-vazia">sem foto</span>
                )}
                <span className="est-foto-acao">
                  {subindoFoto ? 'enviando…' : c.foto ? 'Trocar foto' : '📷 Tirar ou escolher'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={subindoFoto}
                  onChange={(e) => onFoto(c, e.target.files?.[0])}
                />
              </label>
            </div>
          )}

          {/* ---- Preço, custo e aviso ---- */}
          <div className="est-secao">
            <span className="est-secao-tit">💰 Preço e custo</span>
            <div className="est-linha-campos">
              <label className="est-campo">
                <span>Preço de venda</span>
                <div className="est-inp">
                  <i>R$</i>
                  <input
                    type="number"
                    step="0.50"
                    inputMode="decimal"
                    defaultValue={c.preco ?? ''}
                    placeholder="0,00"
                    onBlur={(e) => onCampo(c, 'preco', e.target.value)}
                  />
                </div>
              </label>
              <label className="est-campo">
                <span>Custo da caixa</span>
                <div className="est-inp">
                  <i>R$</i>
                  <input
                    type="number"
                    step="0.50"
                    inputMode="decimal"
                    defaultValue={c.custo_caixa ?? ''}
                    placeholder="0,00"
                    onBlur={(e) => onCampo(c, 'custo_caixa', e.target.value)}
                  />
                </div>
              </label>
            </div>
            <div className="est-linha-campos">
              <label className="est-campo">
                <span>Unid. por caixa</span>
                <div className="est-inp">
                  <input
                    type="number"
                    step="1"
                    inputMode="numeric"
                    defaultValue={c.unidades_caixa ?? ''}
                    placeholder="12"
                    onBlur={(e) => onCampo(c, 'unidades_caixa', e.target.value)}
                  />
                </div>
              </label>
              <label className="est-campo">
                <span>Avisar quando ≤</span>
                <div className="est-inp">
                  <input
                    type="number"
                    step="1"
                    inputMode="numeric"
                    defaultValue={c.estoque_min ?? ''}
                    placeholder="0"
                    onBlur={(e) => onCampo(c, 'estoque_min', e.target.value)}
                  />
                </div>
              </label>
            </div>
            <div className="est-custo-unit">
              {custoUnit != null ? (
                <>
                  Custo por unidade: <b>{money(custoUnit)}</b>
                </>
              ) : (
                'Preencha custo e unidades pra ver o custo por unidade (e o lucro no Relatório).'
              )}
            </div>
          </div>

          {/* ---- Movimento ---- */}
          {controlado && (
            <div className="est-secao">
              <span className="est-secao-tit">📊 Movimento</span>
              <div className="est-stats">
                <div>
                  <span>Entrou</span>
                  <b>{entrou}</b>
                </div>
                <div>
                  <span>Saiu</span>
                  <b>{saiu}</b>
                </div>
                <div>
                  <span>Saldo</span>
                  <b>{saldo}</b>
                </div>
              </div>
              {ents.length > 0 && (
                <div className="est-entradas">
                  <span className="est-entradas-tit">Últimas entradas</span>
                  {ents.slice(0, 4).map((e) => (
                    <div key={e.id} className="est-ent-linha">
                      <span className="est-ent-un">
                        +{e.unidades} un.{e.caixas ? ` (${e.caixas} cx)` : ''}
                      </span>
                      <span className="est-ent-data">
                        {new Date(e.created_at).toLocaleDateString('pt-BR')}
                      </span>
                      <button
                        className="est-ent-x"
                        onClick={() => onRemoverEntrada(e.id)}
                        aria-label="Apagar entrada"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ===================== Módulo: Relatório =====================
// Leitura pura dos `consumos` que o app já tem em mãos. Cada consumo é uma venda
// (item lançado numa comanda), então dá pra montar faturamento, itens e ranking
// sem tocar no banco. Quando o Estoque entrar (com o custo da caixa), aqui ganha
// o LUCRO de verdade; por ora é faturamento (o que saiu).
// As abas do Relatório. "7d"/"30d" são curtos de propósito: com a aba Ontem
// são cinco numa linha só, e "30 dias" por extenso não cabe num celular de
// 360px sem espremer a letra. A linha logo abaixo do seletor continua
// escrevendo por extenso ("Últimas 30 noites, até agora"), então não se perde
// o que a aba quer dizer.
const PERIODOS = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'dia', label: '📅 Dia' },
]

// data de hoje no formato 'AAAA-MM-DD' (hora local) — pro <input type="date">
function hojeISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Que NOITE cada aba está olhando. É o único lugar que decide isso — assim a
// janela do relatório e o troco da gaveta nunca discordam sobre qual noite é.
//
// 7d/30d não olham uma noite só: devolvem null. Quem depende de UMA noite (o
// troco da gaveta, o horário do turno) some da tela nesses períodos, que é o
// certo — o troco é reposto toda noite e apareceria somado 30 vezes.
function noiteDaAba(periodo, dia, hojeBar) {
  if (periodo === 'hoje') return hojeBar
  if (periodo === 'ontem') return somaDia(hojeBar, -1)
  if (periodo === 'dia') return dia || null
  return null
}

// Janela [inicio, fim] em ms — agora medida em NOITES DE BAR, não em dias do
// relógio (ver "O DIA DO BAR" no começo do arquivo):
//   "hoje"  = a noite que está rolando (do fechamento da anterior até agora);
//   "ontem" = a noite de ontem, inteira, madrugada incluída;
//   "dia"   = uma noite escolhida no calendário, inteira, madrugada incluída;
//   7d/30d  = as últimas 7/30 noites, começando no início da mais antiga.
function janelaPeriodo(periodo, dia, caixas = [], virada = HORA_VIRADA, diaAtual = null) {
  const agora = Date.now()
  const atual = diaAtual || diaAtualDoBar(caixas, virada, agora)
  const noite = noiteDaAba(periodo, dia, atual)
  if (noite) return janelaDoDia(noite, caixas, virada, agora)
  const dias = periodo === '7d' ? 7 : 30
  const { inicio } = janelaDoDia(somaDia(atual, -(dias - 1)), caixas, virada, agora)
  return { inicio, fim: agora }
}

// "das 19:04 às 03:12" — avisando quando a noite atravessa a meia-noite
function janelaTexto({ inicio, fim }) {
  const a = new Date(inicio)
  const b = new Date(fim)
  const virou = a.getDate() !== b.getDate()
  return `das ${hora(a)} às ${hora(b)}${virou ? ' do dia seguinte' : ''}`
}

// 'AAAA-MM-DD' → '01/08' pra mostrar bonito no título
function diaBonito(dia) {
  if (!dia) return ''
  const [, m, d] = dia.split('-')
  return `${d}/${m}`
}

// A venda de balcão nasce com o nome "Balcão 19:42" (ver venderBalcao). É por
// esse nome que dá pra separar a venda rápida da comanda com nome de gente —
// não existe coluna de tipo no banco.
function ehBalcao(cli) {
  return !!cli && typeof cli.nome === 'string' && cli.nome.startsWith('Balcão ')
}

// CAIXA de um período: o dinheiro que entrou, por forma, e o que falta receber.
// Fica aqui fora, pura, porque é a parte que TEM que estar certa — é ela que diz
// quanto precisa estar na gaveta no fim do dia.
//
// O dinheiro entra em DOIS momentos, cada um com a sua forma:
//   1. cada parte da conta dividida (um amigo no pix, outro em dinheiro), na
//      hora em que foi paga — mesmo que a comanda continue aberta;
//   2. o que sobrou, na hora de fechar a comanda (e a venda rápida, que já
//      nasce fechada).
// Somar os dois é o que faz a divisão por forma bater com o total recebido.
function calcularCaixa({ pagas, abertas, parciais, totalPorCliente, parcialPorCliente, inicio, fim }) {
  const dentro = (ts) => {
    const t = new Date(ts).getTime()
    return t >= inicio && t <= fim
  }
  const porForma = new Map()
  let recebido = 0
  const somar = (forma, v) => {
    if (v <= 0.009) return
    recebido += v
    porForma.set(forma || null, (porForma.get(forma || null) || 0) + v)
  }
  for (const p of parciais) {
    if (dentro(p.created_at)) somar(p.forma, Number(p.valor || 0))
  }
  for (const c of pagas) {
    if (!c.pago_em || !dentro(c.pago_em)) continue
    // o que já entrou em partes foi contado acima, no dia em que entrou
    const resto = (totalPorCliente.get(c.id) || 0) - (parcialPorCliente.get(c.id) || 0)
    somar(c.forma_pagamento, resto)
  }

  // Comanda deixada pronta pro freguês de todo dia (Alemão, Pedro) fica aberta
  // e zerada. Ela NÃO é "sem pagar" — senão o dono lê 5 devendo quando são 2.
  //
  // `devendo` sai daqui com NOME e valor: é a mesma lista que o Relatório mostra
  // em "Em aberto agora" e que a folha de fechamento usa pra avisar, na hora de
  // fechar o caixa, quem ainda não pagou. Uma conta só, nos dois lugares.
  let emAberto = 0
  let nEsperando = 0
  const devendo = []
  for (const a of abertas) {
    const total = totalPorCliente.get(a.id) || 0
    const falta = Math.max(0, total - (parcialPorCliente.get(a.id) || 0))
    emAberto += falta
    if (total <= 0.009) nEsperando++
    else if (falta > 0.009) devendo.push({ id: a.id, nome: a.nome, total: falta })
  }
  devendo.sort((a, b) => b.total - a.total)
  const nAberto = devendo.length

  // na ordem dos botões da tela; forma desconhecida (ou nenhuma) cai no fim
  const ordem = FORMAS_PAGAMENTO.map((f) => f.id)
  const formas = [...porForma.entries()]
    .map(([id, valor]) => ({ id, valor }))
    .sort((a, b) => {
      const ia = ordem.indexOf(a.id)
      const ib = ordem.indexOf(b.id)
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return b.valor - a.valor
    })
  return {
    recebido,
    emAberto,
    nAberto,
    nEsperando,
    devendo,
    formas,
    dinheiro: porForma.get('dinheiro') || 0,
  }
}

function Relatorio({
  consumos,
  cervejas = [],
  pagas = [],
  abertas = [],
  perdas = [],
  parciais = [],
  caixas = [],
  virada = HORA_VIRADA,
  temCaixas = false,
  caixaAberto = null,
  caixaAtrasado = null,
  diaAtual = null,
  onAbrirCaixa = null,
  onFecharCaixa = null,
}) {
  const [periodo, setPeriodo] = useState('hoje')
  const hojeBar = diaAtual || diaAtualDoBar(caixas, virada)
  // noite escolhida no calendário (modo 'dia') — começa na de hoje
  const [dia, setDia] = useState(() => hojeBar)
  // a noite que está na tela — null em 7d/30d, que olham várias
  const noiteDoPeriodo = noiteDaAba(periodo, dia, hojeBar)
  // abas que olham UMA noite: são as que têm gaveta, turno e nome de dia
  const umaNoite = noiteDoPeriodo != null
  // ...e destas, as que olham uma noite JÁ FECHADA (Ontem e 📅 Dia)
  const noitePassada = umaNoite && periodo !== 'hoje'
  // Os turnos daquela noite. Quase sempre é um só, mas dá pra fechar e reabrir
  // no meio da noite — e aí o horário de verdade da noite vai da PRIMEIRA
  // abertura até o ÚLTIMO fechamento, não de um turno só.
  const primeiroDoPeriodo = primeiroCaixaDe(caixas, noiteDoPeriodo)
  const caixaDoPeriodo = ultimoCaixaDe(caixas, noiteDoPeriodo)
  const nTurnos = nTurnosDaNoite(caixas, noiteDoPeriodo)
  // troco que começou aquela gaveta (ver `fundoDaNoite`: é o do PRIMEIRO turno,
  // não o do último — reabrir no meio da noite não repõe troco nenhum)
  const fundoDoDia = fundoDaNoite(caixas, noiteDoPeriodo)

  // total de cada comanda (soma dos consumos dela) — serve pro caixa
  const totalPorCliente = useMemo(() => {
    const m = new Map()
    for (const c of consumos)
      m.set(c.cliente_id, (m.get(c.cliente_id) || 0) + Number(c.preco_unit) * c.quantidade)
    return m
  }, [consumos])

  // mapa id → comanda (as pagas dos últimos 30d + as abertas agora). Serve pra
  // saber de ONDE veio cada venda e como ela foi paga.
  const clientePorId = useMemo(() => {
    const m = new Map()
    for (const c of pagas) m.set(c.id, c)
    for (const c of abertas) m.set(c.id, c)
    return m
  }, [pagas, abertas])

  // quanto de cada comanda já entrou em partes (conta dividida)
  const parcialPorCliente = useMemo(() => {
    const m = new Map()
    for (const p of parciais)
      m.set(p.cliente_id, (m.get(p.cliente_id) || 0) + Number(p.valor || 0))
    return m
  }, [parciais])

  // CAIXA do período (ver calcularCaixa, logo acima do Relatório)
  const caixa = useMemo(() => {
    const { inicio, fim } = janelaPeriodo(periodo, dia, caixas, virada, hojeBar)
    return calcularCaixa({
      pagas,
      abertas,
      parciais,
      totalPorCliente,
      parcialPorCliente,
      inicio,
      fim,
    })
  }, [
    pagas,
    abertas,
    parciais,
    totalPorCliente,
    parcialPorCliente,
    periodo,
    dia,
    caixas,
    virada,
    hojeBar,
  ])

  // Quem está devendo agora, com nome — o "3 comandas sem pagar" vira lista.
  // Vem do próprio cálculo do caixa (ver `calcularCaixa`), a mesma lista que a
  // folha de fechamento usa pra avisar antes de fechar o dia.
  const devendo = caixa.devendo

  // custo unitário por nome-de-produto (só dos que têm custo cadastrado no Estoque)
  const custoPorNome = useMemo(() => {
    const m = new Map()
    for (const c of cervejas) {
      if (c.custo_caixa && c.unidades_caixa) {
        const repr = c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome
        m.set(repr, Number(c.custo_caixa) / Number(c.unidades_caixa))
      }
    }
    return m
  }, [cervejas])

  const dados = useMemo(() => {
    const { inicio, fim } = janelaPeriodo(periodo, dia, caixas, virada, hojeBar)
    const noPeriodo = consumos.filter((c) => {
      const t = new Date(c.created_at).getTime()
      return t >= inicio && t <= fim
    })
    let faturamento = 0
    let itens = 0
    let custoTotal = 0 // custo só dos itens que têm custo cadastrado
    let vendaComCusto = 0 // venda desses mesmos itens (pra o lucro casar)
    let itensComCusto = 0
    const comandas = new Set()
    const porProduto = new Map()
    // de onde saiu cada venda: comanda com nome ou venda rápida no balcão
    const origem = {
      comanda: { fat: 0, itens: 0, vendas: new Set() },
      balcao: { fat: 0, itens: 0, vendas: new Set() },
    }
    for (const c of noPeriodo) {
      const val = Number(c.preco_unit) * c.quantidade
      faturamento += val
      itens += c.quantidade
      comandas.add(c.cliente_id)
      const o = ehBalcao(clientePorId.get(c.cliente_id)) ? origem.balcao : origem.comanda
      o.fat += val
      o.itens += c.quantidade
      o.vendas.add(c.cliente_id)
      const cu = custoPorNome.get(c.beer_nome)
      if (cu != null) {
        custoTotal += cu * c.quantidade
        vendaComCusto += val
        itensComCusto += c.quantidade
      }
      if (!porProduto.has(c.beer_nome))
        porProduto.set(c.beer_nome, { nome: c.beer_nome, qtd: 0, total: 0 })
      const p = porProduto.get(c.beer_nome)
      p.qtd += c.quantidade
      p.total += val
    }
    const ranking = [...porProduto.values()].sort((a, b) => b.qtd - a.qtd)
    const nComandas = comandas.size
    return {
      faturamento,
      itens,
      nComandas,
      ticket: nComandas ? faturamento / nComandas : 0,
      temCusto: itensComCusto > 0,
      lucro: vendaComCusto - custoTotal, // honesto: só onde há custo cadastrado
      lucroParcial: itensComCusto < itens, // nem todo item tem custo → lucro é de parte
      ranking,
      maxQtd: ranking.reduce((m, p) => Math.max(m, p.qtd), 0),
      origem: {
        comanda: { ...origem.comanda, vendas: origem.comanda.vendas.size },
        balcao: { ...origem.balcao, vendas: origem.balcao.vendas.size },
      },
      vazio: noPeriodo.length === 0,
    }
  }, [consumos, custoPorNome, clientePorId, periodo, dia, caixas, virada, hojeBar])

  // Perdas do período — bloco à parte (NUNCA entra no faturamento/venda)
  const perdasResumo = useMemo(() => {
    const { inicio, fim } = janelaPeriodo(periodo, dia, caixas, virada, hojeBar)
    let qtd = 0
    let valor = 0
    const porProd = new Map()
    for (const p of perdas) {
      const t = new Date(p.created_at).getTime()
      if (t < inicio || t > fim) continue
      qtd += p.quantidade
      valor += Number(p.preco_unit) * p.quantidade
      if (!porProd.has(p.beer_nome)) porProd.set(p.beer_nome, { nome: p.beer_nome, qtd: 0 })
      porProd.get(p.beer_nome).qtd += p.quantidade
    }
    return { qtd, valor, lista: [...porProd.values()].sort((a, b) => b.qtd - a.qtd) }
  }, [perdas, periodo, dia, caixas, virada, hojeBar])

  return (
    <main className="conteudo">
      <div className="rel-periodos">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            className={periodo === p.id ? 'rel-per on' : 'rel-per'}
            onClick={() => setPeriodo(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {periodo === 'hoje' && temCaixas && (
        <BarraCaixa
          caixaAberto={caixaAberto}
          caixaAtrasado={caixaAtrasado}
          diaAtual={hojeBar}
          onAbrir={onAbrirCaixa}
          onFechar={onFecharCaixa}
        />
      )}

      {periodo === 'dia' && (
        <div className="rel-dia">
          <span className="rel-dia-lbl">🧾 Fechamento do dia</span>
          <input
            className="rel-dia-input"
            type="date"
            value={dia}
            max={hojeBar > hojeISO() ? hojeBar : hojeISO()}
            onChange={(e) => setDia(e.target.value)}
          />
        </div>
      )}

      {/* a noite de verdade: das X às Y, madrugada incluída */}
      <p className="rel-janela">
        {periodo === '7d' || periodo === '30d'
          ? `Últimas ${periodo === '7d' ? 7 : 30} noites, até agora.`
          : `Noite de ${diaBonito(noiteDoPeriodo)} · ${janelaTexto(
              janelaPeriodo(periodo, dia, caixas, virada, hojeBar)
            )}`}
        {caixaDoPeriodo && umaNoite && (
          <>
            {' '}
            <span className="rel-janela-cx">
              (caixa aberto {hora((primeiroDoPeriodo || caixaDoPeriodo).aberto_em)}
              {caixaDoPeriodo.fechado_em ? `, fechado ${hora(caixaDoPeriodo.fechado_em)}` : ''}
              {nTurnos > 1 ? ` · ${nTurnos} turnos na mesma noite` : ''})
            </span>
          </>
        )}
      </p>

      {dados.vazio && perdasResumo.qtd === 0 ? (
        <p className="vazio">
          {noitePassada
            ? `Nenhuma venda na noite de ${diaBonito(noiteDoPeriodo)}.`
            : 'Nenhuma venda nesse período ainda.'}
        </p>
      ) : (
        <>
          {!dados.vazio && (
          <>
          <div className="rel-kpis">
            <div className="kpi kpi-destaque">
              <span className="kpi-lbl">Faturamento</span>
              <strong className="kpi-val">{money(dados.faturamento)}</strong>
            </div>
            {dados.temCusto && (
              <div className="kpi kpi-lucro">
                <span className="kpi-lbl">
                  Lucro{dados.lucroParcial ? ' *' : ''}
                </span>
                <strong className="kpi-val">{money(dados.lucro)}</strong>
              </div>
            )}
            <div className="kpi">
              <span className="kpi-lbl">Itens vendidos</span>
              <strong className="kpi-val">{dados.itens}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-lbl">Comandas</span>
              <strong className="kpi-val">{dados.nComandas}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-lbl">Média por comanda</span>
              <strong className="kpi-val">{money(dados.ticket)}</strong>
              <span className="caixa-sub">quanto cada uma gastou, em média</span>
            </div>
          </div>

          <h3 className="sec">🛒 De onde veio</h3>
          <div className="rel-kpis">
            <div className="kpi">
              <span className="kpi-lbl">🧾 Comanda</span>
              <strong className="kpi-val">{money(dados.origem.comanda.fat)}</strong>
              <span className="caixa-sub">
                {dados.origem.comanda.vendas} comanda
                {dados.origem.comanda.vendas === 1 ? '' : 's'} · {dados.origem.comanda.itens} un.
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-lbl">⚡ Venda rápida</span>
              <strong className="kpi-val">{money(dados.origem.balcao.fat)}</strong>
              <span className="caixa-sub">
                {dados.origem.balcao.vendas} venda{dados.origem.balcao.vendas === 1 ? '' : 's'} ·{' '}
                {dados.origem.balcao.itens} un.
              </span>
            </div>
          </div>
          {dados.temCusto && dados.lucroParcial && (
            <p className="rel-nota">
              * Lucro só dos produtos com <b>custo cadastrado</b> no Estoque.
              Cadastre o custo dos demais pra ver o lucro cheio.
            </p>
          )}

          <h3 className="sec">💳 Caixa</h3>
          <div className="rel-caixa">
            <div className="caixa-card caixa-recebido">
              <span className="kpi-lbl">
                {noitePassada
                  ? `Recebido em ${diaBonito(noiteDoPeriodo)}`
                  : 'Recebido no período'}
              </span>
              <strong className="kpi-val">{money(caixa.recebido)}</strong>
              {caixa.formas.length > 0 && (
                <div className="caixa-formas">
                  {caixa.formas.map((f) => (
                    <div key={f.id || 'outro'} className="cf-linha">
                      <span>{rotuloForma(f.id)}</span>
                      <b>{money(f.valor)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Gaveta: só faz sentido numa noite só (o troco é reposto toda
                noite; numa janela de 7/30 dias apareceria repetido). */}
            {umaNoite && (
              <div className="caixa-card caixa-gaveta">
                <span className="kpi-lbl">💵 Tem que ter na gaveta</span>
                <strong className="kpi-val">{money(fundoDoDia + caixa.dinheiro)}</strong>
                <div className="caixa-formas">
                  <div className="cf-linha">
                    <span>Troco que começa o dia</span>
                    <b>{money(fundoDoDia)}</b>
                  </div>
                  <div className="cf-linha">
                    <span>Vendas em dinheiro</span>
                    <b>{money(caixa.dinheiro)}</b>
                  </div>
                  {/* o que ele contou de verdade na hora de fechar o caixa */}
                  {caixaDoPeriodo && caixaDoPeriodo.contado != null && (
                    <div className="cf-linha">
                      <span>Contou na gaveta</span>
                      <b>{money(caixaDoPeriodo.contado)}</b>
                    </div>
                  )}
                </div>
                {caixaDoPeriodo && caixaDoPeriodo.contado != null ? (
                  <span className="caixa-sub">
                    {(() => {
                      const dif = Number(caixaDoPeriodo.contado) - (fundoDoDia + caixa.dinheiro)
                      if (Math.abs(dif) < 0.01) return '✓ A gaveta bateu certinho.'
                      return dif > 0
                        ? `Sobrou ${money(dif)} na gaveta — provável erro de troco.`
                        : `Faltou ${money(-dif)} na gaveta — provável erro de troco.`
                    })()}
                  </span>
                ) : (
                  <span className="caixa-sub">
                    Conte a gaveta no fim do dia: sobrando ou faltando, a diferença é
                    erro de troco.
                  </span>
                )}
              </div>
            )}
            {/* "agora" é agora mesmo: conta as comandas abertas NESTE momento,
                não as da janela. Numa noite que já fechou (Ontem, 📅 Dia) ela
                não diz nada sobre aquela noite — só confundiria. */}
            {!noitePassada && (
              <div className="caixa-card caixa-aberto">
                <span className="kpi-lbl">Em aberto agora</span>
                <strong className="kpi-val">{money(caixa.emAberto)}</strong>
                <span className="caixa-sub">
                  {caixa.nAberto} comanda{caixa.nAberto === 1 ? '' : 's'} sem pagar
                  {caixa.nEsperando > 0 &&
                    ` · ${caixa.nEsperando} pronta${caixa.nEsperando === 1 ? '' : 's'} esperando`}
                </span>
                {devendo.length > 0 && (
                  <div className="caixa-formas">
                    {devendo.map((c) => (
                      <div key={c.id} className="cf-linha">
                        <span>{c.nome}</span>
                        <b>{money(c.total)}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="rel-nota">
            <b>Faturamento</b> é tudo que saiu no período, pago ou não.{' '}
            <b>Recebido</b> é o dinheiro que entrou de verdade — contando também a
            parte que um amigo já pagou numa comanda que continua aberta. O que
            ainda falta receber está em "Em aberto agora".
          </p>

          <h3 className="sec">Mais vendidos</h3>
          <div className="rel-ranking">
            {dados.ranking.map((p, i) => (
              <div key={p.nome} className="rk-item">
                <span className="rk-pos">{i + 1}</span>
                <div className="rk-corpo">
                  <div className="rk-topo">
                    <span className="rk-nome">{p.nome}</span>
                    <span className="rk-total">{money(p.total)}</span>
                  </div>
                  <div className="rk-barra-bg">
                    <div
                      className="rk-barra"
                      style={{ width: (dados.maxQtd ? (p.qtd / dados.maxQtd) * 100 : 0) + '%' }}
                    />
                  </div>
                  <span className="rk-qtd">{p.qtd} un.</span>
                </div>
              </div>
            ))}
          </div>
          </>
          )}

          {perdasResumo.qtd > 0 && (
            <>
              <h3 className="sec">🗑️ Perdas no período</h3>
              <div className="rel-perdas">
                <div className="perda-kpi">
                  <span className="kpi-lbl">Itens perdidos</span>
                  <strong className="kpi-val">{perdasResumo.qtd}</strong>
                </div>
                {perdasResumo.valor > 0 && (
                  <div className="perda-kpi">
                    <span className="kpi-lbl">Prejuízo (preço de venda)</span>
                    <strong className="kpi-val">{money(perdasResumo.valor)}</strong>
                  </div>
                )}
              </div>
              <div className="rel-perda-lista">
                {perdasResumo.lista.map((p) => (
                  <div key={p.nome} className="rel-perda-item">
                    <span className="rel-perda-nome">{p.nome}</span>
                    <span className="rel-perda-qtd">{p.qtd} un.</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  )
}

// Módulo ligado no painel, mas a tela ainda vai ser construída. Mostra o que ele
// vai fazer pra não ficar um branco. Quando o módulo real ficar pronto, ele
// substitui isto aqui (o encanamento — abas + coluna `modulos` — já fica de pé).
function ModuloEmBreve({ mod }) {
  return (
    <main className="conteudo">
      <div className="modulo-embreve">
        <span className="me-icone">{mod.icone}</span>
        <h3 className="me-titulo">{mod.label}</h3>
        <span className="me-tag">Em construção</span>
        <p className="me-texto">{mod.resumo}</p>
      </div>
    </main>
  )
}

function Aviso() {
  return (
    <div className="centro aviso">
      <h2>⚙️ Falta configurar o Supabase</h2>
      <p>
        Abra o arquivo <code>.env</code> e cole sua <b>URL</b> e <b>chave anon</b> do
        Supabase, depois rode o app de novo.
      </p>
    </div>
  )
}
