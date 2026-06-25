import { useEffect, useMemo, useState } from 'react'
import { supabase, isConfigured } from './supabase.js'

const money = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',')
const hora = (ts) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

// cor da marca de cada cerveja (pelo nome). Cerveja nova usa o dourado padrão.
const CORES_CERVEJA = [
  { match: 'brahma', bg: '#c81f28', fg: '#ffffff' },
  { match: 'original', bg: '#e7b21c', fg: '#2a1d00' },
  { match: 'heineken', bg: '#15a03f', fg: '#ffffff' },
  { match: 'spaten', bg: '#11633a', fg: '#f4efe6' },
  { match: 'antarctica', bg: '#1566c0', fg: '#ffffff' },
]
const corCerveja = (nome) => {
  const n = (nome || '').toLowerCase()
  return (
    CORES_CERVEJA.find((c) => n.includes(c.match)) || {
      bg: 'var(--accent)',
      fg: 'var(--accent-dark)',
    }
  )
}

export default function App() {
  const [aba, setAba] = useState('comandas') // 'comandas' | 'cervejas'
  const [cervejas, setCervejas] = useState([])
  const [clientes, setClientes] = useState([])
  const [consumos, setConsumos] = useState([])
  const [busca, setBusca] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [abertoId, setAbertoId] = useState(null) // cliente aberto na tela de detalhe
  const [carregando, setCarregando] = useState(true)

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

  useEffect(() => {
    carregar()
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
    const { data } = await supabase
      .from('clientes')
      .insert({ nome })
      .select()
      .single()
    setNovoNome('')
    if (data) {
      setClientes((cs) => [...cs, data])
      setAbertoId(data.id)
    }
  }

  async function adicionarConsumo(cliente_id, cerveja, quantidade) {
    const { data } = await supabase
      .from('consumos')
      .insert({
        cliente_id,
        beer_nome: cerveja.tamanho ? `${cerveja.nome} ${cerveja.tamanho}` : cerveja.nome,
        preco_unit: cerveja.preco,
        quantidade,
      })
      .select()
      .single()
    if (data) setConsumos((cs) => [data, ...cs])
  }

  async function removerConsumo(id) {
    await supabase.from('consumos').delete().eq('id', id)
    setConsumos((cs) => cs.filter((c) => c.id !== id))
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
        <AbaCervejas cervejas={cervejas} setCervejas={setCervejas} recarregar={carregar} />
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
    </div>
  )
}

const ORDEM_TAM = { Lata: 0, Latão: 1 }

// categorias do cadastro: cada uma filtra os formatos que fazem sentido.
// "Lata"/"Latão" são exatos de propósito (disparam o card Latão | Nome | Lata).
const CATEGORIAS = [
  { id: 'cerveja', label: '🍺 Cerveja', formatos: ['Lata', 'Latão', 'Long Neck', 'Garrafa 600ml', 'Litrão 1L'] },
  { id: 'refri', label: '🥤 Refri', formatos: ['Lata', 'Garrafa 600ml', '1L', '1,5L', '2L'] },
  { id: 'agua', label: '💧 Água', formatos: ['Copo 300ml', 'Garrafa 500ml', 'Garrafa 1,5L'] },
  { id: 'outro', label: '➕ Outro', formatos: [] },
]
const rankFmt = (t) => (t === 'Latão' ? 0 : t === 'Lata' ? 1 : 2)

function Detalhe({ cliente, cervejas, consumos, resumo, onAdd, onRemove, onFechar, onExcluir, onVoltar }) {
  const [qtd, setQtd] = useState(1)
  const [recentes, setRecentes] = useState([]) // nomes usados, mais recente primeiro
  const [buscaProd, setBuscaProd] = useState('')

  function tocar(cv) {
    onAdd(cliente.id, cv, qtd)
    setQtd(1)
    setBuscaProd('') // ao selecionar, limpa a busca; o produto sobe pro topo
    setRecentes((r) => [cv.nome, ...r.filter((n) => n !== cv.nome)])
  }

  // agrupa os produtos por nome (Lata + Latão viram um card só) e ordena
  // colocando os que a pessoa está bebendo no topo
  const grupos = useMemo(() => {
    const map = new Map()
    for (const cv of cervejas) {
      if (!map.has(cv.nome))
        map.set(cv.nome, { nome: cv.nome, ordem: cv.ordem, variantes: [] })
      map.get(cv.nome).variantes.push(cv)
    }
    const arr = [...map.values()]
    for (const g of arr)
      g.variantes.sort(
        (a, b) => (ORDEM_TAM[a.tamanho] ?? 2) - (ORDEM_TAM[b.tamanho] ?? 2)
      )
    arr.sort((a, b) => {
      const ia = recentes.indexOf(a.nome)
      const ib = recentes.indexOf(b.nome)
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1
        if (ib === -1) return -1
        return ia - ib
      }
      return a.ordem - b.ordem
    })
    return arr
  }, [cervejas, recentes])

  const q = buscaProd.trim().toLowerCase()
  const gruposVis = q
    ? grupos.filter((g) => g.nome.toLowerCase().includes(q))
    : grupos

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
          {gruposVis.length === 0 && (
            <p className="vazio">
              {q
                ? 'Nenhum produto encontrado.'
                : 'Nenhum produto cadastrado. Vá em "Produtos".'}
            </p>
          )}
          {gruposVis.map((g) => {
            const cor = corCerveja(g.nome)
            const destaque = recentes[0] === g.nome
            const latao = g.variantes.find((v) => v.tamanho === 'Latão')
            const lata = g.variantes.find((v) => v.tamanho === 'Lata')
            const semTam = g.variantes.find((v) => !v.tamanho)
            const extras = g.variantes.filter(
              (v) => v.tamanho && v.tamanho !== 'Lata' && v.tamanho !== 'Latão'
            )
            // clássico = só Lata/Latão/sem tamanho → card bonito com nome no meio
            const classico = extras.length === 0
            const dir = lata || semTam // lado direito no modo clássico
            const btn = (v) => (
              <button key={v.id} className="rp-side" onClick={() => tocar(v)}>
                {v.tamanho && <span className="rp-tam">{v.tamanho}</span>}
                <span className="rp-preco">{money(v.preco)}</span>
              </button>
            )
            return (
              <div
                key={g.nome}
                className={
                  'row-prod' +
                  (destaque ? ' destaque' : '') +
                  (classico ? '' : ' row-multi')
                }
                style={{ background: cor.bg, color: cor.fg }}
              >
                {classico ? (
                  <>
                    {latao && btn(latao)}
                    <div className="rp-nome">{g.nome}</div>
                    {dir && btn(dir)}
                  </>
                ) : (
                  <>
                    <div className="rp-nome">{g.nome}</div>
                    <div className="rp-botoes">
                      {[latao, lata, ...extras, semTam].filter(Boolean).map(btn)}
                    </div>
                  </>
                )}
              </div>
            )
          })}
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

function AbaCervejas({ cervejas, setCervejas, recarregar }) {
  const [nome, setNome] = useState('')
  const [categoria, setCategoria] = useState('cerveja')
  const [formatos, setFormatos] = useState({}) // { 'Lata': '5,00', 'Latão': '7,00' }
  const [extras, setExtras] = useState([]) // [{ tam, preco }] livres

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

  async function salvarPreco(id, valor) {
    const v = Number(String(valor).replace(',', '.')) || 0
    await supabase.from('cervejas').update({ preco: v }).eq('id', id)
    setCervejas((cs) => cs.map((c) => (c.id === id ? { ...c, preco: v } : c)))
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
    const comOrdem = novos.map((x, i) => ({ ...x, ordem: base + i }))
    const { data } = await supabase.from('cervejas').insert(comOrdem).select()
    if (data) setCervejas((cs) => [...cs, ...data])
    setNome('')
    setFormatos({})
    setExtras([])
  }

  async function remover(id) {
    if (!confirm('Remover este produto da lista?')) return
    await supabase.from('cervejas').update({ ativo: false }).eq('id', id)
    setCervejas((cs) => cs.filter((c) => c.id !== id))
  }

  return (
    <main className="conteudo">
      <h3 className="sec">Preços dos produtos</h3>
      <div className="lista-cervejas">
        {cervejas.map((c) => (
          <div key={c.id} className="linha-cerveja">
            <span className="lc-nome">
              {c.nome}
              {c.tamanho && <span className="lc-tam">{c.tamanho}</span>}
            </span>
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
            <button className="lc-x" onClick={() => remover(c.id)}>
              ✕
            </button>
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
