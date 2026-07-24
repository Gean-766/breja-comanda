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

// `distribuidora` e `onSair` vêm do Portao.jsx (quem já passou pelo login).
// O RLS do banco já isola os dados por distribuidora; os filtros por
// distribuidora_id aqui embaixo são só uma segunda tranca.
export default function App({ distribuidora = null, onSair = null }) {
  const donoId = distribuidora?.id || null
  // abas extras que esse cliente contratou (vêm ligadas do painel CEO)
  const modulos = Array.isArray(distribuidora?.modulos) ? distribuidora.modulos : []
  const abasExtra = ORDEM_MODULOS.filter((k) => modulos.includes(k) && MODULOS[k])
  const [aba, setAba] = useState('comandas') // núcleo: 'comandas' | 'cervejas' | 'historico' + módulos
  const [cervejas, setCervejas] = useState([])
  const [clientes, setClientes] = useState([])
  const [consumos, setConsumos] = useState([])
  const [historico, setHistorico] = useState([])
  const [entradas, setEntradas] = useState([]) // entradas de estoque (módulo Estoque)
  const [busca, setBusca] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [abertoId, setAbertoId] = useState(null) // cliente aberto na tela de detalhe
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
    const nome = novoNome.trim()
    if (!nome) return
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

  async function fecharConta(cliente_id) {
    const cli = clientes.find((c) => c.id === cliente_id)
    const r = resumo[cliente_id] || { total: 0, qtd: 0 }
    await supabase
      .from('clientes')
      .update({ aberto: false, pago_em: new Date().toISOString() })
      .eq('id', cliente_id)
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    setAbertoId(null)
    setBusca('')
    if (cli)
      registrar(
        'fechar_cliente',
        `Fechou/pagou a comanda de ${cli.nome} (${money(r.total)})`,
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
          <button
            className={aba === 'cervejas' ? 'aba on' : 'aba'}
            onClick={() => setAba('cervejas')}
          >
            Produtos
          </button>
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
              placeholder="Nome da pessoa"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarPessoa()}
            />
            <button className="btn-grande" onClick={adicionarPessoa}>
              + Nova
            </button>
          </div>

          {clientes.length > 3 && (
            <div className="busca-wrap">
              <input
                className="campo busca"
                placeholder="🔎 Procurar nome…"
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
            <p className="vazio">Nenhuma comanda aberta. Adicione uma pessoa acima.</p>
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

      {aba === 'cervejas' && (
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
          <Relatorio consumos={consumos} cervejas={cervejas} />
        ) : aba === 'estoque' ? (
          <AbaEstoque
            cervejas={cervejas}
            setCervejas={setCervejas}
            entradas={entradas}
            setEntradas={setEntradas}
            consumos={consumos}
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
          onAdd={adicionarConsumo}
          onRemove={removerConsumo}
          onFechar={fecharConta}
          onExcluir={excluirCliente}
          onVoltar={() => {
            setAbertoId(null)
            setBusca('')
          }}
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

const ORDEM_TAM = { Lata: 0, Latão: 1 }

// categorias do cadastro: cada uma filtra os formatos que fazem sentido.
// "Lata"/"Latão" são exatos de propósito (disparam o card Latão | Nome | Lata).
const CATEGORIAS = [
  { id: 'cerveja', label: '🍺 Cerveja', formatos: ['Lata', 'Latão', 'Long Neck', 'Garrafa 600ml', 'Litrão 1L', 'Caixa', 'Engradado 300ml', 'Engradado 600ml'] },
  { id: 'refri', label: '🥤 Refri', formatos: ['Lata', 'Garrafa 600ml', '1L', '1,5L', '2L'] },
  { id: 'energetico', label: '⚡ Energético', formatos: ['Lata 250ml', 'Lata 269ml', 'Lata 473ml', '1L', '2L'] },
  { id: 'agua', label: '💧 Água', formatos: ['Copo 300ml', 'Garrafa 500ml', 'Garrafa 1,5L'] },
  { id: 'outro', label: '➕ Outro', formatos: [] },
]
const rankFmt = (t) => (t === 'Latão' ? 0 : t === 'Lata' ? 1 : 2)

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

function Detalhe({ cliente, cervejas, consumos, resumo, onAdd, onRemove, onFechar, onExcluir, onVoltar }) {
  const [qtd, setQtd] = useState(1)
  const [buscaProd, setBuscaProd] = useState('')
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const [ultimoTocado, setUltimoTocado] = useState(null) // só p/ a animação
  const [mostrarResumo, setMostrarResumo] = useState(false)
  const [confirmar, setConfirmar] = useState(null) // produto aguardando confirmação

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
          <h2>{cliente.nome}</h2>
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
          <div className="rodape-top">
            <div className="total-grande">
              <span className="tg-itens">{resumo.qtd} produtos consumidos</span>
              <strong>{money(resumo.total)}</strong>
            </div>
            <button
              className="btn-resumo"
              onClick={() => setMostrarResumo(true)}
              disabled={resumo.qtd === 0}
            >
              📋 Resumo
            </button>
          </div>
          <button
            className="btn-pagar"
            onClick={() => {
              if (confirm(`Fechar e marcar como PAGO a conta de ${cliente.nome}?`))
                onFechar(cliente.id)
            }}
          >
            ✓ Pagar / Fechar
          </button>
        </footer>
      </div>

      {mostrarResumo && (
        <div className="resumo-overlay" onClick={() => setMostrarResumo(false)}>
          <div className="resumo-box" onClick={(e) => e.stopPropagation()}>
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

function AbaCervejas({ cervejas, setCervejas, onErro, onLog }) {
  const [nome, setNome] = useState('')
  const [categoria, setCategoria] = useState('cerveja')
  const [formatos, setFormatos] = useState({}) // { 'Lata': '5,00', 'Latão': '7,00' }
  const [extras, setExtras] = useState([]) // [{ tam, preco }] livres
  const [corSel, setCorSel] = useState('') // '' = automática
  const [editId, setEditId] = useState(null)
  const [editNome, setEditNome] = useState('')
  const [editTam, setEditTam] = useState('')

  const cat = CATEGORIAS.find((c) => c.id === categoria) || CATEGORIAS[0]

  const escolherCategoria = (id) => {
    setCategoria(id)
    setFormatos({}) // formatos dependem da categoria
  }
  const toggleFormato = (f) =>
    setFormatos((m) => {
      const n = { ...m }
      if (f in n) delete n[f]
      else n[f] = ''
      return n
    })
  const setFormatoPreco = (f, v) => setFormatos((m) => ({ ...m, [f]: v }))

  const addExtra = (tam = '') => setExtras((e) => [...e, { tam, preco: '' }])
  const setExtra = (i, campo, val) =>
    setExtras((e) => e.map((x, j) => (j === i ? { ...x, [campo]: val } : x)))
  const remExtra = (i) => setExtras((e) => e.filter((_, j) => j !== i))

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
    const parse = (p) => Number(String(p).replace(',', '.')) || 0
    const novos = []
    Object.entries(formatos)
      .sort((a, b) => rankFmt(a[0]) - rankFmt(b[0]))
      .forEach(([tam, preco]) =>
        novos.push({ nome: n, tamanho: tam, preco: parse(preco) })
      )
    for (const x of extras.filter((x) => x.tam.trim()))
      novos.push({ nome: n, tamanho: x.tam.trim(), preco: parse(x.preco) })
    if (novos.length === 0) novos.push({ nome: n, tamanho: '', preco: 0 })

    const base = cervejas.reduce((m, c) => Math.max(m, c.ordem ?? 0), 0) + 1
    const comOrdem = novos.map((x, i) => ({ ...x, ordem: base + i, cor: corSel || null }))

    // tenta com a coluna "cor"; se ela ainda não existe no banco, salva sem ela
    let res = await supabase.from('cervejas').insert(comOrdem).select()
    if (res.error && /cor/i.test(res.error.message || '')) {
      const semCor = comOrdem.map(({ cor, ...x }) => x)
      res = await supabase.from('cervejas').insert(semCor).select()
    }
    if (res.error || !res.data) {
      return onErro('⚠️ Não consegui salvar o produto. Tente de novo.')
    }
    setCervejas((cs) => [...cs, ...res.data])
    const qf = res.data.length
    onLog?.(
      'add_produto',
      `Adicionou produto: ${n} (${qf} formato${qf === 1 ? '' : 's'})`,
      { ids: res.data.map((r) => r.id) }
    )
    setNome('')
    setFormatos({})
    setExtras([])
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
          placeholder="Marca (ex: Original, Heineken, Água)"
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
        <div className="tam-pick">
          <span className="tam-label">É o quê?</span>
          {CATEGORIAS.map((c) => (
            <button
              key={c.id}
              className={categoria === c.id ? 'tam on' : 'tam'}
              onClick={() => escolherCategoria(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {cat.formatos.length > 0 && (
          <div className="tam-pick">
            <span className="tam-label">Formatos:</span>
            {cat.formatos.map((f) => (
              <button
                key={f}
                className={f in formatos ? 'tam on' : 'tam'}
                onClick={() => toggleFormato(f)}
              >
                {f in formatos ? '✓ ' : ''}
                {f}
              </button>
            ))}
          </div>
        )}

        {Object.keys(formatos).map((f) => (
          <div key={f} className="preco-tam">
            <span className="preco-tam-lbl">{f} — R$</span>
            <input
              className="campo campo-preco-novo"
              placeholder="0,00"
              type="number"
              step="0.50"
              inputMode="decimal"
              value={formatos[f]}
              onChange={(e) => setFormatoPreco(f, e.target.value)}
            />
          </div>
        ))}

        <div className="extras-sec">
          <div className="chips">
            <button className="chip chip-livre" onClick={() => addExtra('')}>
              + Outro formato
            </button>
          </div>
          {extras.map((x, i) => (
            <div key={i} className="preco-tam extra-row">
              <input
                className="campo extra-tam"
                placeholder="Formato (ex: Garrafinha 300ml)"
                value={x.tam}
                onChange={(e) => setExtra(i, 'tam', e.target.value)}
              />
              <span className="preco-tam-lbl preco-rs">R$</span>
              <input
                className="campo campo-preco-novo"
                placeholder="0,00"
                type="number"
                step="0.50"
                inputMode="decimal"
                value={x.preco}
                onChange={(e) => setExtra(i, 'preco', e.target.value)}
              />
              <button className="lc-x" onClick={() => remExtra(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>

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
          + Add produto
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

// ===================== Módulo: Estoque =====================
// Saldo = (contagem inicial + abastecimentos) − (saídas nas comandas desde a
// contagem). A saída já existe nos `consumos` (casados pelo nome do produto).
// Custo da caixa + unidades por caixa dão o custo unitário — e, lá no Relatório,
// o lucro de verdade. Não toca no fluxo das comandas: é só leitura + entradas.
function AbaEstoque({ cervejas, setCervejas, entradas, setEntradas, consumos, onErro }) {
  const [abertoId, setAbertoId] = useState(null)
  const reprDe = (c) => (c.tamanho ? `${c.nome} ${c.tamanho}` : c.nome)

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

  if (cervejas.length === 0) {
    return (
      <main className="conteudo">
        <p className="vazio">
          Cadastre produtos na aba <b>Produtos</b> primeiro. Depois volta aqui pra
          controlar o estoque deles.
        </p>
      </main>
    )
  }

  return (
    <main className="conteudo">
      <p className="est-aviso">
        O saldo cai sozinho a cada venda. Comece cada produto com a{' '}
        <b>contagem do que tem hoje</b> — daí pra frente o sistema acompanha.
      </p>
      <div className="est-lista">
        {lista.map((it) => (
          <EstoqueCard
            key={it.c.id}
            it={it}
            aberto={abertoId === it.c.id}
            onAbrir={() => setAbertoId((id) => (id === it.c.id ? null : it.c.id))}
            onCampo={salvarCampo}
            onAbastecer={abastecer}
            onRemoverEntrada={removerEntrada}
          />
        ))}
      </div>
    </main>
  )
}

function EstoqueCard({ it, aberto, onAbrir, onCampo, onAbastecer, onRemoverEntrada }) {
  const { c, controlado, entrou, saiu, saldo, custoUnit, nivel, ents } = it
  // começa em "unidades" enquanto não houver unid/caixa (assim o 1º uso — a
  // contagem inicial — funciona na hora); com caixa configurada, vai pra "caixas"
  const [modo, setModo] = useState(c.unidades_caixa ? 'caixas' : 'unidades')
  const [qtd, setQtd] = useState('')
  const reprDe = (x) => (x.tamanho ? `${x.nome} ${x.tamanho}` : x.nome)

  const badge =
    nivel === 'novo'
      ? { txt: 'sem controle', cls: 'est-novo' }
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

      {aberto && (
        <div className="est-corpo">
          <div className="est-linha-campos">
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
          </div>

          <div className="est-linha-campos est-linha-2">
            <div className="est-custo-unit">
              {custoUnit != null ? (
                <>
                  Custo por unidade: <b>{money(custoUnit)}</b>
                </>
              ) : (
                'Preencha custo e unidades pra ver o custo unitário (e o lucro no Relatório).'
              )}
            </div>
            <label className="est-campo est-campo-min">
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

          {!controlado && (
            <p className="est-dica">
              Primeira vez: conte o que tem no estoque agora e registre. Isso vira o
              ponto de partida — a partir daí cada venda desconta.
            </p>
          )}

          {controlado && (
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
          )}

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
]

// começo do período, em ms. "Hoje" é o dia do calendário (meia-noite local);
// 7d/30d são janelas corridas terminando agora.
function inicioPeriodo(periodo) {
  const agora = new Date()
  if (periodo === 'hoje') {
    const d = new Date(agora)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const dias = periodo === '7d' ? 7 : 30
  return agora.getTime() - dias * 24 * 60 * 60 * 1000
}

function Relatorio({ consumos, cervejas = [] }) {
  const [periodo, setPeriodo] = useState('hoje')

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
    const inicio = inicioPeriodo(periodo)
    const noPeriodo = consumos.filter(
      (c) => new Date(c.created_at).getTime() >= inicio
    )
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
  }, [consumos, custoPorNome, periodo])

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

      {dados.vazio ? (
        <p className="vazio">Nenhuma venda nesse período ainda.</p>
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
