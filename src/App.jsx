import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isConfigured } from './supabase.js'

const money = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',')
const hora = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

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

// formas de pagamento: a chave (id) é o que fica salvo em clientes.forma_pagamento;
// o rótulo/ícone é só pra tela. Comanda antiga (sem forma) vira "• Outro".
const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', label: 'Dinheiro', icone: '💵' },
  { id: 'pix', label: 'Pix', icone: '⚡' },
  { id: 'cartao', label: 'Cartão', icone: '💳' },
]
const rotuloForma = (id) => {
  const f = FORMAS_PAGAMENTO.find((x) => x.id === id)
  return f ? `${f.icone} ${f.label}` : '• Outro'
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
  const [aba, setAba] = useState('comandas') // núcleo: 'comandas' | 'cervejas' | 'historico' + módulos
  const [cervejas, setCervejas] = useState([])
  const [clientes, setClientes] = useState([])
  const [consumos, setConsumos] = useState([])
  const [historico, setHistorico] = useState([])
  const [entradas, setEntradas] = useState([]) // entradas de estoque (módulo Estoque)
  const [pagas, setPagas] = useState([]) // comandas já pagas nos últimos 30d (módulo Relatório)
  const [parciais, setParciais] = useState([]) // pagamentos parciais das comandas abertas (conta dividida)
  const [busca, setBusca] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [abertoId, setAbertoId] = useState(null) // cliente aberto na tela de detalhe
  const [balcaoAberto, setBalcaoAberto] = useState(false) // overlay da venda rápida (balcão)
  const [carregando, setCarregando] = useState(true)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef()

  function mostrarToast(msg, opts = {}) {
    clearTimeout(toastTimer.current)
    setToast({ msg, tipo: opts.tipo || 'info', acao: opts.acao || null, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), opts.acao ? 6000 : 3500)
  }
  const erro = (msg) => mostrarToast(msg, { tipo: 'erro' })

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

    // Estoque só carrega se o módulo estiver ligado. Fica num select à parte
    // (não no Promise.all) pra que, se a tabela ainda não existir no banco,
    // o erro morra aqui e não derrube o resto do carregamento.
    if (abasExtra.includes('estoque')) {
      const qe = meu(supabase.from('estoque_entradas').select('*'))
      const re = await qe.order('created_at', { ascending: false })
      setEntradas(re.data || [])
    }

    // Conta dividida: pagamentos parciais das comandas ainda abertas. Fica à
    // parte (fora do Promise.all) pra não derrubar o resto se a tabela ainda
    // não existir no banco — o app degrada sozinho até rodar o SQL.
    const abertosIds = (c2.data || []).map((c) => c.id)
    if (abertosIds.length) {
      const rpp = await meu(supabase.from('pagamentos_parciais').select('*')).in('cliente_id', abertosIds)
      setParciais(rpp.error ? [] : rpp.data || [])
    } else {
      setParciais([])
    }

    // Relatório precisa das comandas JÁ PAGAS pra montar o "recebido" (as abertas
    // já vêm em `clientes`). Últimos 30 dias — bate com o maior período do relatório.
    if (abasExtra.includes('relatorio')) {
      const desde30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const rp = await meu(supabase.from('clientes').select('*'))
        .eq('aberto', false)
        .gte('pago_em', desde30d)
        .order('pago_em', { ascending: false })
      setPagas(rp.data || [])
    }
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
      .subscribe()

    // rede de segurança: se o tempo real cair (celular parado/bloqueado),
    // recarrega ao voltar pro app e a cada 4s enquanto está aberto
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') carregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('focus', aoVoltar)
    const intervalo = setInterval(aoVoltar, 4000)

    return () => {
      clearTimeout(t)
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('focus', aoVoltar)
      supabase.removeChannel(canal)
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
      } else if (h.tipo === 'abrir_cliente') {
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
        await supabase.from('cervejas').delete().in('id', p.ids || [])
      } else if (h.tipo === 'remover_produto') {
        await supabase.from('cervejas').update({ ativo: true }).eq('id', p.produto.id)
      } else if (h.tipo === 'editar_produto') {
        await supabase
          .from('cervejas')
          .update({ nome: p.antes.nome, tamanho: p.antes.tamanho })
          .eq('id', p.id)
      } else if (h.tipo === 'mudar_preco') {
        await supabase.from('cervejas').update({ preco: p.antes }).eq('id', p.id)
      } else if (h.tipo === 'venda_balcao') {
        // apaga a venda de balcão (a comanda fechada + os consumos, em cascata)
        await supabase.from('clientes').delete().eq('id', p.cliente.id)
      } else if (h.tipo === 'pagar_parte') {
        await supabase.from('pagamentos_parciais').delete().eq('id', p.parcial.id)
      } else if (h.tipo === 'renomear_cliente') {
        await supabase.from('clientes').update({ nome: p.antes }).eq('id', p.id)
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
    registrar(
      'remover_consumo',
      `−${item.quantidade}× ${item.beer_nome}${cli ? ' — ' + cli.nome : ''}`,
      { consumo: item }
    )
    mostrarToast('Item removido', {
      acao: {
        label: '↩ Desfazer',
        fn: async () => {
          const { data } = await supabase
            .from('consumos')
            .insert({
              cliente_id: item.cliente_id,
              beer_nome: item.beer_nome,
              preco_unit: item.preco_unit,
              quantidade: item.quantidade,
              created_at: item.created_at,
            })
            .select()
            .single()
          if (data) setConsumos((cs) => [data, ...cs])
        },
      },
    })
  }

  async function fecharConta(cliente_id, forma = null) {
    const cli = clientes.find((c) => c.id === cliente_id)
    const r = resumo[cliente_id] || { total: 0, qtd: 0 }
    const pago_em = new Date().toISOString()
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
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    // já joga na lista de pagas pro Relatório refletir na hora
    if (cli) setPagas((ps) => [{ ...cli, aberto: false, pago_em, forma_pagamento: forma }, ...ps])
    setAbertoId(null)
    setBusca('')
    if (cli)
      registrar(
        'fechar_cliente',
        `Fechou/pagou a comanda de ${cli.nome} (${money(r.total)}${forma ? ' · ' + forma : ''})`,
        { cliente: cli }
      )
  }

  async function excluirCliente(cliente_id) {
    // captura tudo ANTES de apagar, pra conseguir restaurar depois
    const cli = clientes.find((c) => c.id === cliente_id)
    const cons = consumos.filter((c) => c.cliente_id === cliente_id)
    await supabase.from('clientes').delete().eq('id', cliente_id)
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    setAbertoId(null)
    setBusca('')
    if (cli) {
      const h = await registrar(
        'excluir_cliente',
        `Excluiu a comanda de ${cli.nome} (${cons.length} lançamento${cons.length === 1 ? '' : 's'})`,
        { cliente: cli, consumos: cons }
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

  // Ao sair de uma comanda (‹ Voltar): faxina pedida pelo lojista.
  //  - vazia (aberta e nada pedido) → some.
  //  - totalmente paga (dividida e quitada) → fecha (sai da lista de abertas).
  //  - senão, continua aberta normalmente.
  async function sairDaComanda() {
    const id = abertoId
    setAbertoId(null)
    setBusca('')
    if (!id) return
    const cons = consumos.filter((c) => c.cliente_id === id)
    const total = resumo[id]?.total || 0
    const pagoP = parciais
      .filter((p) => p.cliente_id === id)
      .reduce((s, p) => s + Number(p.valor || 0), 0)
    if (cons.length === 0 && pagoP <= 0.009) {
      await supabase.from('clientes').delete().eq('id', id)
      setClientes((cs) => cs.filter((c) => c.id !== id))
    } else if (total > 0 && total - pagoP <= 0.009) {
      fecharConta(id)
    }
  }

  // VENDA DE BALCÃO (venda rápida): "pediu, pagou e levou". Não abre comanda com
  // nome — cria uma comanda já FECHADA na hora com os itens. Assim o estoque baixa
  // e o relatório conta, exatamente como qualquer venda, sem trabalho extra.
  async function venderBalcao(itens) {
    if (!itens?.length) return
    const nome = 'Balcão ' + hora(Date.now())
    const pago_em = new Date().toISOString()
    const { data: cli, error } = await supabase
      .from('clientes')
      .insert({ nome, aberto: false, pago_em })
      .select()
      .single()
    if (error || !cli) {
      erro('⚠️ Não consegui registrar a venda. Sem conexão?')
      return
    }
    const linhas = itens.map((it) => ({
      cliente_id: cli.id,
      beer_nome: it.cerveja.tamanho ? `${it.cerveja.nome} ${it.cerveja.tamanho}` : it.cerveja.nome,
      preco_unit: it.cerveja.preco,
      quantidade: it.qtd,
    }))
    const { data: cons } = await supabase.from('consumos').insert(linhas).select()
    if (cons?.length) setConsumos((cs) => [...cons, ...cs]) // estoque + relatório na hora
    setPagas((ps) => [{ ...cli }, ...ps]) // caixa "recebido" reflete na hora
    const total = linhas.reduce((s, r) => s + Number(r.preco_unit) * r.quantidade, 0)
    setBalcaoAberto(false)
    registrar('venda_balcao', `Venda de balcão (${money(total)})`, { cliente: cli })
    mostrarToast('Venda de balcão registrada ✓', { tipo: 'ok' })
  }

  // CONTA DIVIDIDA: registra o quanto um amigo pagou (por garrafa ou por valor).
  // A mesa continua aberta mostrando "Falta pagar" até quitar tudo.
  async function pagarParte(cliente_id, valor, qtd = null, itens = null) {
    const v = Number(valor) || 0
    if (v <= 0) return
    // guarda QUAIS garrafas foram pagas (no obs, em JSON) — assim a garrafa já paga
    // some da lista de "escolher garrafas" e o verde/vermelho do movimento bate.
    const obs = itens && itens.length ? JSON.stringify(itens) : null
    const { data, error } = await supabase
      .from('pagamentos_parciais')
      .insert({ cliente_id, valor: v, qtd, obs })
      .select()
      .single()
    if (error || !data) {
      erro('⚠️ Ative a conta dividida: rode o SQL "conta-dividida" no Supabase.')
      return
    }
    setParciais((ps) => [data, ...ps])
    const cli = clientes.find((c) => c.id === cliente_id)
    registrar(
      'pagar_parte',
      `Pagou parte: ${money(v)}${cli ? ' — ' + cli.nome : ''}`,
      { parcial: data }
    )
    mostrarToast(`Recebido ${money(v)} ✓`, { tipo: 'ok' })
  }

  if (!isConfigured) return <Aviso />
  if (carregando) return <div className="centro">Carregando…</div>

  const clienteAberto = clientes.find((c) => c.id === abertoId)

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
          <div className="add-pessoa">
            <input
              className="campo"
              placeholder={modoMesa ? 'Nº da mesa (ex: 3)' : 'Nome da pessoa'}
              inputMode={modoMesa ? 'numeric' : 'text'}
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarPessoa()}
            />
            <button className="btn-grande" onClick={adicionarPessoa}>
              {modoMesa ? '+ Mesa' : '+ Nova'}
            </button>
          </div>

          {cervejas.length > 0 && (
            <button className="btn-balcao" onClick={() => setBalcaoAberto(true)}>
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
              return (
                <button key={c.id} className="card" onClick={() => setAbertoId(c.id)}>
                  <span className="card-nome">{c.nome}</span>
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
          />
        ) : aba === 'estoque' ? (
          <AbaEstoque
            cervejas={cervejas}
            setCervejas={setCervejas}
            entradas={entradas}
            setEntradas={setEntradas}
            consumos={consumos}
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
            onErro={erro}
          />
        ) : (
          MODULOS[aba] && <ModuloEmBreve mod={MODULOS[aba]} />
        ))}

      {clienteAberto && (
        <Detalhe
          cliente={clienteAberto}
          cervejas={cervejas}
          consumos={consumos.filter((co) => co.cliente_id === clienteAberto.id)}
          resumo={resumo[clienteAberto.id] || { total: 0, qtd: 0 }}
          parciais={parciais.filter((p) => p.cliente_id === clienteAberto.id)}
          onAdd={adicionarConsumo}
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
          onVender={venderBalcao}
          onVoltar={() => setBalcaoAberto(false)}
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

function Detalhe({ cliente, cervejas, consumos, resumo, parciais = [], onAdd, onRemove, onPagarParte, onFechar, onExcluir, onRenomear, onVoltar }) {
  const [qtd, setQtd] = useState(1)
  const [editNome, setEditNome] = useState(false) // editando o nome da comanda
  const [nomeEdit, setNomeEdit] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [mostrarTodos, setMostrarTodos] = useState(false)
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
  const [pessoas, setPessoas] = useState(0) // dividir a conta entre N pessoas (modo valor)
  const [dividirN, setDividirN] = useState(1) // calculadora "dividir" na tela da mesa

  const reprDe = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

  function tocar(c) {
    onAdd(cliente.id, c, qtd)
    setQtd(1)
    setBuscaProd('') // ao selecionar, limpa a busca
    setUltimoTocado(c.id)
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

  const q = normalizar(buscaProd)
  const filtrados = q
    ? ordenados.filter(
        (c) => normalizar(c.nome).includes(q) || normalizar(reprDe(c)).includes(q)
      )
    : ordenados
  const expandido = !!q || mostrarTodos
  const visiveis = expandido ? filtrados : filtrados.slice(0, 3)

  // se a busca não achou nada, tenta corrigir pelo nome dos produtos cadastrados
  const nomesProdutos = useMemo(
    () => [...new Set(cervejas.map((c) => c.nome))],
    [cervejas]
  )
  const sugBusca = filtrados.length === 0 ? sugerir(buscaProd, nomesProdutos) : null

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
  const garrafas = useMemo(() => {
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
  }, [consumos, parciais])
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
    onPagarParte(cliente.id, valor, qtd, itens)
    const zerou = resumo.total - (pago + valor) <= 0.009
    fecharParte()
    if (zerou) setConfPagto(true) // quitou → já oferece encerrar a comanda
  }
  function confirmarExcesso() {
    if (!excesso) return
    onPagarParte(cliente.id, excesso.valor, excesso.qtd, excesso.itens)
    fecharParte()
    setConfPagto(true) // recebeu o resto (ou mais) → oferece encerrar
  }
  function salvarNome() {
    const n = nomeEdit.trim()
    if (n && n !== cliente.nome) onRenomear(cliente.id, n)
    setEditNome(false)
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
              onClick={() => {
                if (
                  confirm(
                    `Excluir ${cliente.nome} da lista? (apaga tudo, mesmo sem pagar)`
                  )
                )
                  onExcluir(cliente.id)
              }}
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

        <div className="busca-wrap busca-prod">
          <input
            className="campo busca"
            placeholder="🔎 Procurar produto…"
            value={buscaProd}
            onChange={(e) => setBuscaProd(e.target.value)}
          />
          {buscaProd && (
            <button
              className="busca-x"
              onClick={() => setBuscaProd('')}
              aria-label="Limpar busca"
            >
              ✕
            </button>
          )}
        </div>

        <div className="lista-prod">
          {filtrados.length === 0 &&
            (sugBusca ? (
              <div className="sug-marca">
                <span className="tam-label">🤔 Você quis dizer?</span>
                <div className="chips">
                  {sugBusca.nomes.map((m) => (
                    <button
                      key={m}
                      className="chip chip-sug"
                      onClick={() => setBuscaProd(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="vazio">
                {q
                  ? 'Nenhum produto encontrado.'
                  : 'Nenhum produto cadastrado. Vá em "Produtos".'}
              </p>
            ))}
          {visiveis.map((c) => {
            const cor = corDe(c.nome, c.cor)
            return (
              <button
                key={c.id}
                className={'prod-card' + (ultimoTocado === c.id ? ' destaque' : '')}
                style={{ background: cor.bg, color: cor.fg }}
                onClick={() => setConfirmar(c)}
              >
                <span className="pc-nome">{c.nome}</span>
                <span className="pc-info">
                  {c.tamanho && <span className="pc-tam">{c.tamanho}</span>}
                  <span className="pc-preco">{money(c.preco)}</span>
                </span>
              </button>
            )
          })}

          {!expandido && filtrados.length > 3 && (
            <button className="ver-mais" onClick={() => setMostrarTodos(true)}>
              Ver mais produtos ({filtrados.length - 3}) ▾
            </button>
          )}
          {mostrarTodos && !q && filtrados.length > 3 && (
            <button className="ver-mais" onClick={() => setMostrarTodos(false)}>
              Ver menos ▴
            </button>
          )}
        </div>

        <div className="historico">
          {consumos.length === 0 && <p className="vazio">Ainda nada lançado.</p>}
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
        </div>

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
            <button className="pag-confirmar" onClick={() => onFechar(cliente.id)}>
              {quitado ? '✓ Encerrar comanda' : '✓ Confirmar pagamento'}
            </button>
            <button className="pag-cancelar" onClick={() => setConfPagto(false)}>
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

      {confirmar && (() => {
        const cor = corDe(confirmar.nome, confirmar.cor)
        return (
          <div className="confirm-overlay" onClick={() => setConfirmar(null)}>
            <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
              <button
                className="confirm-x"
                onClick={() => setConfirmar(null)}
                aria-label="Cancelar"
              >
                ✕
              </button>
              <p className="confirm-msg">Clica em OK para confirmar</p>
              <span
                className="confirm-prod"
                style={{ background: cor.bg, color: cor.fg }}
              >
                {qtd}× {reprDe(confirmar)}
              </span>
              <button
                className="confirm-ok"
                onClick={() => {
                  tocar(confirmar)
                  setConfirmar(null)
                }}
              >
                OK
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// VENDA RÁPIDA (balcão): monta um carrinho, toca nos produtos e vende de uma vez.
// Não abre comanda com nome — quem chama (App.venderBalcao) grava como venda fechada.
function VendaBalcao({ cervejas, onVender, onVoltar }) {
  const [carrinho, setCarrinho] = useState({}) // {cervejaId: qtd}
  const [busca, setBusca] = useState('')

  const q = normalizar(busca)
  const filtrados = q
    ? cervejas.filter(
        (c) =>
          normalizar(c.nome).includes(q) ||
          normalizar(c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome).includes(q)
      )
    : cervejas

  function add(c) {
    setCarrinho((k) => ({ ...k, [c.id]: (k[c.id] || 0) + 1 }))
  }
  function mudar(id, delta) {
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

        <div className="busca-wrap busca-prod">
          <input
            className="campo busca"
            placeholder="🔎 Procurar produto…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <button className="busca-x" onClick={() => setBusca('')} aria-label="Limpar busca">
              ✕
            </button>
          )}
        </div>

        <div className="lista-prod">
          {filtrados.length === 0 && <p className="vazio">Nenhum produto encontrado.</p>}
          {filtrados.map((c) => {
            const cor = corDe(c.nome, c.cor)
            const n = carrinho[c.id] || 0
            return (
              <button
                key={c.id}
                className={'prod-card' + (n ? ' destaque' : '')}
                style={{ background: cor.bg, color: cor.fg }}
                onClick={() => add(c)}
              >
                <span className="pc-nome">
                  {c.nome}
                  {n > 0 && <span className="pc-badge">{n}</span>}
                </span>
                <span className="pc-info">
                  {c.tamanho && <span className="pc-tam">{c.tamanho}</span>}
                  <span className="pc-preco">{money(c.preco)}</span>
                </span>
              </button>
            )
          })}
        </div>

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
          <div className="rodape-top">
            <div className="total-grande">
              <span className="tg-itens">{totalItens} item{totalItens === 1 ? '' : 's'}</span>
              <strong>{money(total)}</strong>
            </div>
          </div>
          <button
            className="btn-pagar"
            disabled={itensCarrinho.length === 0}
            onClick={() => onVender(itensCarrinho)}
          >
            ✓ Vender {money(total)}
          </button>
        </footer>
      </div>
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
    const { error } = await supabase
      .from('cervejas')
      .update({ nome: nm, tamanho: tam })
      .eq('id', editId)
    if (error) return onErro('⚠️ Não salvou a edição. Tente de novo.')
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
  add_produto: { icone: '🆕' },
  remover_produto: { icone: '❌' },
  editar_produto: { icone: '✏️' },
  mudar_preco: { icone: '💲' },
}

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
  // blocos começam FECHADOS; guardamos quais foram abertos pelo toque
  const [abertos, setAbertos] = useState(() => new Set())
  const toggle = (id) =>
    setAbertos((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // agrupa por comanda (pessoa). historico já vem do mais recente p/ o mais antigo,
  // então a ordem dos blocos segue a última atividade de cada comanda.
  const { blocos, catalogo } = useMemo(() => {
    const map = new Map()
    const cat = []
    for (const h of historico) {
      const r = refCliente(h)
      if (!r.id) {
        cat.push(h)
        continue
      }
      if (!map.has(r.id)) map.set(r.id, { id: r.id, nome: '', itens: [] })
      const b = map.get(r.id)
      if (!b.nome && r.nome) b.nome = r.nome
      b.itens.push(h)
    }
    return { blocos: [...map.values()], catalogo: cat }
  }, [historico])

  // ícone/estado do bloco pela ação "mais final" que aconteceu na comanda
  const estadoDe = (itens) => {
    if (itens.some((h) => h.tipo === 'excluir_cliente'))
      return { icone: '🗑️', cls: 'h-excluir' }
    if (itens.some((h) => h.tipo === 'fechar_cliente'))
      return { icone: '✅', cls: 'h-fechar' }
    return { icone: '🟢', cls: 'h-abrir' }
  }
  const plural = (n) => (n === 1 ? 'movimentação' : 'movimentações')

  return (
    <main className="conteudo">
      <h3 className="sec">Histórico — últimas 24h</h3>
      <p className="hist-aviso">
        Agrupado por comanda. Toque numa pessoa pra ver/ocultar o que rolou nela.
        Fica 24h aqui (e ~30 dias guardado no servidor). Dá pra desfazer.
      </p>

      {historico.length === 0 && (
        <p className="vazio">Nenhuma movimentação nas últimas 24 horas.</p>
      )}

      {blocos.map((b) => {
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
      })}

      {catalogo.length > 0 &&
        (() => {
          const aberto = abertos.has('__cat__')
          return (
            <div className={'hist-bloco h-prod' + (aberto ? ' on' : '')}>
              <button className="hist-bloco-cab" onClick={() => toggle('__cat__')}>
                <span className="hbc-icone">📦</span>
                <div className="hbc-texto">
                  <span className="hbc-nome">Produtos / Catálogo</span>
                  <span className="hbc-meta">
                    {catalogo.length} {plural(catalogo.length)}
                  </span>
                </div>
                <span className="hbc-acao">{aberto ? '▾ fechar' : 'abrir ›'}</span>
              </button>
              {aberto && (
                <div className="hist-bloco-itens">
                  {catalogo.map((h) => (
                    <LinhaHist key={h.id} h={h} onReverter={onReverter} />
                  ))}
                </div>
              )}
            </div>
          )
        })()}
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

function AbaCozinha({ cervejas, setCervejas, consumos, setConsumos, clientes, onErro }) {
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
  const hojeIni = new Date().setHours(0, 0, 0, 0)

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
            new Date(co.pronto_em).getTime() >= hojeIni
        )
        .sort((a, b) => new Date(b.pronto_em) - new Date(a.pronto_em)),
    [consumos, reprsCozinha]
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
  { id: 'energetico', label: 'Energético', icone: '⚡', kw: ['energetico', 'energy', 'red bull', 'redbull', 'monster', 'tnt', 'fusion', 'baly', 'red horse', 'burn'] },
  { id: 'agua', label: 'Água', icone: '💧', kw: ['agua', 'água', 'bonafont', 'indaia', 'minalba', 'crystal'] },
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
function iconePasta(label) {
  const known = CATEGORIAS_ESTOQUE.find((c) => c.label === label)
  return known ? known.icone : '🏷️'
}

function AbaEstoque({ cervejas, setCervejas, entradas, setEntradas, consumos, onErro, onLog }) {
  const [abertoId, setAbertoId] = useState(null)
  const [vista, setVista] = useState('estoque') // 'estoque' (visão geral) | 'cadastro'
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
  const [pastasCustom, setPastasCustom] = useState([]) // pastas criadas nesta sessão
  const reprDe = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

  function abrirForm(pasta) {
    setNovoPasta(pasta)
    setNNome('')
    setNPreco('')
    setNQtd('')
    setNUnid('')
    setNCusto('')
    setNAviso('')
    setNModo('caixas')
    setPastaAberta(pasta) // entra na pasta pra cadastrar dentro dela
  }
  function novaPasta() {
    const nome = (prompt('Nome da nova pasta (ex: Doses, Porções, Gelo):') || '').trim()
    if (!nome) return
    if (!pastasCustom.includes(nome)) setPastasCustom((p) => [...p, nome])
    abrirForm(nome) // já abre o form pra cadastrar o 1º produto dessa pasta
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
    // grava a pasta escolhida; se a coluna ainda não existe no banco, salva sem ela
    let res = await supabase.from('cervejas').insert({ ...base, categoria: novoPasta }).select().single()
    if (res.error && /categoria/i.test(res.error.message || '')) {
      res = await supabase.from('cervejas').insert(base).select().single()
    }
    const prod = res.data
    if (res.error || !prod) return onErro('⚠️ Não consegui salvar o produto. Tente de novo.')
    setCervejas((cs) => [...cs, prod])
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
    setNovoPasta(null)
  }

  async function excluirProduto(c) {
    if (!confirm(`Excluir ${reprDe(c)}? Ele some das comandas e do estoque.`)) return
    const { error } = await supabase.from('cervejas').update({ ativo: false }).eq('id', c.id)
    if (error) return onErro('⚠️ Não consegui excluir. Tente de novo.')
    setCervejas((cs) => cs.filter((x) => x.id !== c.id))
    onLog?.('remover_produto', `Removeu produto: ${reprDe(c)}`, { produto: c })
  }

  async function renomear(c) {
    const atual = reprDe(c)
    const novo = (prompt('Novo nome do produto:', atual) || '').trim()
    if (!novo || novo === atual) return
    const { error } = await supabase
      .from('cervejas')
      .update({ nome: novo, tamanho: '' })
      .eq('id', c.id)
    if (error) return onErro('⚠️ Não consegui renomear. Tente de novo.')
    setCervejas((cs) => cs.map((x) => (x.id === c.id ? { ...x, nome: novo, tamanho: '' } : x)))
  }

  // saídas somadas por nome-de-produto, guardando o instante (pra cortar no "desde")
  const saidasPorNome = useMemo(() => {
    const m = new Map()
    for (const co of consumos) {
      if (!m.has(co.beer_nome)) m.set(co.beer_nome, [])
      m.get(co.beer_nome).push({ qtd: co.quantidade, ts: new Date(co.created_at).getTime() })
    }
    return m
  }, [consumos])

  const entradasPorCerveja = useMemo(() => {
    const m = new Map()
    for (const e of entradas) {
      if (!m.has(e.cerveja_id)) m.set(e.cerveja_id, [])
      m.get(e.cerveja_id).push(e)
    }
    return m
  }, [entradas])

  // calcula tudo por produto e ordena (alertas no topo)
  const lista = useMemo(() => {
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
      if (controlado) {
        for (const s of saidasPorNome.get(reprDe(c)) || []) if (s.ts >= desde) saiu += s.qtd
      }
      const saldo = entrou - saiu
      const custoUnit =
        c.custo_caixa && c.unidades_caixa
          ? Number(c.custo_caixa) / Number(c.unidades_caixa)
          : null
      const min = Number(c.estoque_min) || 0
      let nivel = 'novo'
      if (controlado) nivel = saldo <= 0 ? 'zero' : min > 0 && saldo <= min ? 'baixo' : 'ok'
      return { c, controlado, entrou, saiu, saldo, custoUnit, min, nivel, ents }
    })
    const rank = { zero: 0, baixo: 1, ok: 2, novo: 3 }
    return arr.sort(
      (a, b) => rank[a.nivel] - rank[b.nivel] || a.c.nome.localeCompare(b.c.nome)
    )
  }, [cervejas, entradasPorCerveja, saidasPorNome])

  // busca por nome (quando tem texto, ignora as pastas e mostra tudo que casa)
  const listaFiltrada = useMemo(() => {
    const q = normalizar(busca)
    if (!q) return lista
    return lista.filter((it) => normalizar(reprDe(it.c)).includes(q))
  }, [lista, busca])

  // pastas por label (as que têm produto + as criadas na sessão), com alertas.
  // Conhecidas na ordem oficial; pastas criadas pelo lojista, depois, alfabético.
  const pastas = useMemo(() => {
    const map = new Map()
    for (const it of lista) {
      const lbl = pastaDe(it.c)
      if (!map.has(lbl)) map.set(lbl, [])
      map.get(lbl).push(it)
    }
    for (const lbl of pastasCustom) if (!map.has(lbl)) map.set(lbl, [])
    const ordemConhecida = CATEGORIAS_ESTOQUE.map((c) => c.label)
    const labels = [...map.keys()].sort((a, b) => {
      const ia = ordemConhecida.indexOf(a)
      const ib = ordemConhecida.indexOf(b)
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return a.localeCompare(b)
    })
    return labels.map((label) => {
      const itens = map.get(label)
      const alertas = itens.filter((i) => i.nivel === 'zero' || i.nivel === 'baixo').length
      return { label, icone: iconePasta(label), itens, alertas }
    })
  }, [lista, pastasCustom])

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
    if (!confirm('Apagar essa entrada? O saldo volta ao que era.')) return
    const { error } = await supabase.from('estoque_entradas').delete().eq('id', id)
    if (error) return onErro('⚠️ Não consegui apagar. Tente de novo.')
    setEntradas((es) => es.filter((e) => e.id !== id))
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

      <div className="est-novo-acoes">
        <button className="btn-grande" onClick={criarProduto}>
          ✓ Salvar
        </button>
        <button className="est-cancelar" onClick={() => setNovoPasta(null)}>
          Cancelar
        </button>
      </div>
    </div>
  )

  const pastaFoco = pastaAberta ? pastas.find((p) => p.label === pastaAberta) : null
  const itensFoco = pastaFoco ? pastaFoco.itens : []

  if (pastaAberta) {
    // ---------- DETALHE: só a pasta escolhida ----------
    return (
      <main className="conteudo">
        <div className="est-nav">
          <button
            className="est-voltar"
            onClick={() => {
              setPastaAberta(null)
              setNovoPasta(null)
            }}
          >
            ‹ Voltar
          </button>
          <span className="est-nav-tit">
            {iconePasta(pastaAberta)} {pastaAberta}
          </span>
        </div>

        {itensFoco.length > 0 && (
          <div className="est-lista">{itensFoco.map(renderCard)}</div>
        )}
        {itensFoco.length === 0 && novoPasta !== pastaAberta && (
          <p className="est-pasta-vazia">Pasta vazia — adicione o primeiro produto.</p>
        )}

        {novoPasta === pastaAberta ? (
          renderForm()
        ) : (
          <button className="est-add-pasta" onClick={() => abrirForm(pastaAberta)}>
            + Adicionar produto
          </button>
        )}
      </main>
    )
  }

  // ---------- TOPO: Meu estoque (visão geral) | Cadastrar ----------
  const overviewRows = busca.trim() ? listaFiltrada : lista
  const nRepor = lista.filter((i) => i.nivel === 'zero' || i.nivel === 'baixo').length
  const irPara = (it) => {
    setBusca('')
    setVista('cadastro')
    setPastaAberta(pastaDe(it.c))
    setAbertoId(it.c.id)
  }

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
      </div>

      {cervejas.length > 3 && (
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
                <div className={nRepor > 0 ? 'est-vg-repor' : ''}>
                  <b>{nRepor}</b>
                  <span>pra repor</span>
                </div>
              </div>
            )}
            {overviewRows.length === 0 ? (
              <p className="vazio">Nenhum produto com esse nome.</p>
            ) : (
              <div className="est-vg-lista">
                {overviewRows.map((it) => (
                  <button
                    key={it.c.id}
                    className="est-vg-row"
                    onClick={() => irPara(it)}
                  >
                    <span className={'est-vg-status est-' + it.nivel} />
                    <span className="est-vg-nome">{reprDe(it.c)}</span>
                    <span className={'est-vg-saldo est-' + it.nivel}>
                      {it.controlado ? it.saldo : '—'}
                      <small> un.</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )
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
    </main>
  )
}

function EstoqueCard({ it, aberto, onAbrir, onCampo, onAbastecer, onRemoverEntrada, onExcluir, onRenomear }) {
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
const PERIODOS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'dia', label: '📅 Dia' },
]

// data de hoje no formato 'AAAA-MM-DD' (hora local) — pro <input type="date">
function hojeISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// janela [inicio, fim] em ms. "Hoje" = do começo do dia até agora; 7d/30d = janelas
// corridas terminando agora; "dia" = um dia específico do calendário (00:00→23:59).
function janelaPeriodo(periodo, dia) {
  const agora = new Date()
  if (periodo === 'dia' && dia) {
    const [a, m, d] = dia.split('-').map(Number)
    const ini = new Date(a, m - 1, d, 0, 0, 0, 0)
    const fim = new Date(a, m - 1, d, 23, 59, 59, 999)
    return { inicio: ini.getTime(), fim: fim.getTime() }
  }
  if (periodo === 'hoje') {
    const d = new Date(agora)
    d.setHours(0, 0, 0, 0)
    return { inicio: d.getTime(), fim: agora.getTime() }
  }
  const dias = periodo === '7d' ? 7 : 30
  return { inicio: agora.getTime() - dias * 24 * 60 * 60 * 1000, fim: agora.getTime() }
}

// 'AAAA-MM-DD' → '01/08' pra mostrar bonito no título
function diaBonito(dia) {
  if (!dia) return ''
  const [, m, d] = dia.split('-')
  return `${d}/${m}`
}

function Relatorio({ consumos, cervejas = [], pagas = [], abertas = [] }) {
  const [periodo, setPeriodo] = useState('hoje')
  const [dia, setDia] = useState(hojeISO) // dia escolhido no calendário (modo 'dia')

  // total de cada comanda (soma dos consumos dela) — serve pro caixa
  const totalPorCliente = useMemo(() => {
    const m = new Map()
    for (const c of consumos)
      m.set(c.cliente_id, (m.get(c.cliente_id) || 0) + Number(c.preco_unit) * c.quantidade)
    return m
  }, [consumos])

  // caixa: quanto ENTROU no período (comandas pagas) + o que está aberto AGORA.
  // Só o total — o cliente não separa por dinheiro/pix/cartão.
  const caixa = useMemo(() => {
    const { inicio, fim } = janelaPeriodo(periodo, dia)
    let recebido = 0
    for (const p of pagas) {
      if (!p.pago_em) continue
      const t0 = new Date(p.pago_em).getTime()
      if (t0 < inicio || t0 > fim) continue
      recebido += totalPorCliente.get(p.id) || 0
    }
    let emAberto = 0
    for (const a of abertas) emAberto += totalPorCliente.get(a.id) || 0
    return { recebido, emAberto, nAberto: abertas.length }
  }, [pagas, abertas, totalPorCliente, periodo, dia])

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
    const { inicio, fim } = janelaPeriodo(periodo, dia)
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
    for (const c of noPeriodo) {
      const val = Number(c.preco_unit) * c.quantidade
      faturamento += val
      itens += c.quantidade
      comandas.add(c.cliente_id)
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
      vazio: noPeriodo.length === 0,
    }
  }, [consumos, custoPorNome, periodo, dia])

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

      {periodo === 'dia' && (
        <div className="rel-dia">
          <span className="rel-dia-lbl">🧾 Fechamento do dia</span>
          <input
            className="rel-dia-input"
            type="date"
            value={dia}
            max={hojeISO()}
            onChange={(e) => setDia(e.target.value)}
          />
        </div>
      )}

      {dados.vazio ? (
        <p className="vazio">
          {periodo === 'dia'
            ? `Nenhuma venda no dia ${diaBonito(dia)}.`
            : 'Nenhuma venda nesse período ainda.'}
        </p>
      ) : (
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
              <span className="kpi-lbl">Ticket médio</span>
              <strong className="kpi-val">{money(dados.ticket)}</strong>
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
                {periodo === 'dia' ? `Recebido em ${diaBonito(dia)}` : 'Recebido no período'}
              </span>
              <strong className="kpi-val">{money(caixa.recebido)}</strong>
            </div>
            {periodo !== 'dia' && (
              <div className="caixa-card caixa-aberto">
                <span className="kpi-lbl">Em aberto agora</span>
                <strong className="kpi-val">{money(caixa.emAberto)}</strong>
                <span className="caixa-sub">
                  {caixa.nAberto} comanda{caixa.nAberto === 1 ? '' : 's'} sem pagar
                </span>
              </div>
            )}
          </div>

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
