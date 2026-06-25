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

export default function App() {
  const [aba, setAba] = useState('comandas') // 'comandas' | 'cervejas'
  const [cervejas, setCervejas] = useState([])
  const [clientes, setClientes] = useState([])
  const [consumos, setConsumos] = useState([])
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
    const [c1, c2, c3] = await Promise.all([
      supabase.from('cervejas').select('*').eq('ativo', true).order('ordem'),
      supabase.from('clientes').select('*').eq('aberto', true).order('created_at'),
      supabase.from('consumos').select('*').order('created_at', { ascending: false }),
    ])
    setCervejas(c1.data || [])
    setClientes(c2.data || [])
    setConsumos(c3.data || [])
    setCarregando(false)
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
      .subscribe()
    return () => {
      clearTimeout(t)
      supabase.removeChannel(canal)
    }
  }, [])

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
    await supabase
      .from('clientes')
      .update({ aberto: false, pago_em: new Date().toISOString() })
      .eq('id', cliente_id)
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    setAbertoId(null)
    setBusca('')
  }

  async function excluirCliente(cliente_id) {
    await supabase.from('clientes').delete().eq('id', cliente_id)
    setClientes((cs) => cs.filter((c) => c.id !== cliente_id))
    setAbertoId(null)
    setBusca('')
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
            <h1>BREJA &amp; CIA</h1>
            <span className="marca-sub">Distribuidora · Comanda</span>
          </div>
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
        <AbaCervejas cervejas={cervejas} setCervejas={setCervejas} onErro={erro} />
      )}

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
  { id: 'cerveja', label: '🍺 Cerveja', formatos: ['Lata', 'Latão', 'Long Neck', 'Garrafa 600ml', 'Litrão 1L'] },
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
                onClick={() => tocar(c)}
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
          <div className="total-grande">
            <span>{resumo.qtd} itens</span>
            <strong>{money(resumo.total)}</strong>
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
    </div>
  )
}

function AbaCervejas({ cervejas, setCervejas, onErro }) {
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
    const { error } = await supabase.from('cervejas').update({ preco: v }).eq('id', id)
    if (error) return onErro('⚠️ Não salvou o preço. Tente de novo.')
    setCervejas((cs) => cs.map((c) => (c.id === id ? { ...c, preco: v } : c)))
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
    const { error } = await supabase
      .from('cervejas')
      .update({ nome: nm, tamanho: tam })
      .eq('id', editId)
    if (error) return onErro('⚠️ Não salvou a edição. Tente de novo.')
    setCervejas((cs) =>
      cs.map((c) => (c.id === editId ? { ...c, nome: nm, tamanho: tam } : c))
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
    setNome('')
    setFormatos({})
    setExtras([])
    setCorSel('')
  }

  async function remover(id) {
    if (!confirm('Remover este produto da lista?')) return
    const { error } = await supabase.from('cervejas').update({ ativo: false }).eq('id', id)
    if (error) return onErro('⚠️ Não consegui remover. Tente de novo.')
    setCervejas((cs) => cs.filter((c) => c.id !== id))
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
