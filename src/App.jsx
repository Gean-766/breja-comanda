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

function Detalhe({ cliente, cervejas, consumos, resumo, onAdd, onRemove, onFechar, onExcluir, onVoltar }) {
  const [qtd, setQtd] = useState(1)
  const [recentes, setRecentes] = useState([]) // nomes usados, mais recente primeiro

  function tocar(cv) {
    onAdd(cliente.id, cv, qtd)
    setQtd(1)
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

        <div className="lista-prod">
          {grupos.map((g) => {
            const cor = corCerveja(g.nome)
            const destaque = recentes[0] === g.nome
            const latao = g.variantes.find((v) => v.tamanho === 'Latão')
            const lata = g.variantes.find((v) => v.tamanho === 'Lata')
            const dir = lata || g.variantes.find((v) => !v.tamanho) // lado direito
            return (
              <div
                key={g.nome}
                className={'row-prod' + (destaque ? ' destaque' : '')}
                style={{ background: cor.bg, color: cor.fg }}
              >
                {latao && (
                  <button className="rp-side" onClick={() => tocar(latao)}>
                    <span className="rp-tam">Latão</span>
                    <span className="rp-preco">{money(latao.preco)}</span>
                  </button>
                )}

                <div className="rp-nome">{g.nome}</div>

                {dir && (
                  <button className="rp-side" onClick={() => tocar(dir)}>
                    {dir.tamanho && <span className="rp-tam">{dir.tamanho}</span>}
                    <span className="rp-preco">{money(dir.preco)}</span>
                  </button>
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
  const [tamanho, setTamanho] = useState('')
  const [preco, setPreco] = useState('')

  async function salvarPreco(id, valor) {
    const v = Number(String(valor).replace(',', '.')) || 0
    await supabase.from('cervejas').update({ preco: v }).eq('id', id)
    setCervejas((cs) => cs.map((c) => (c.id === id ? { ...c, preco: v } : c)))
  }

  async function adicionar() {
    const n = nome.trim()
    if (!n) return
    const v = Number(String(preco).replace(',', '.')) || 0
    const ordem = cervejas.length
    const { data } = await supabase
      .from('cervejas')
      .insert({ nome: n, tamanho, preco: v, ordem })
      .select()
      .single()
    if (data) setCervejas((cs) => [...cs, data])
    setNome('')
    setTamanho('')
    setPreco('')
  }

  async function remover(id) {
    if (!confirm('Remover este produto da lista?')) return
    await supabase.from('cervejas').update({ ativo: false }).eq('id', id)
    setCervejas((cs) => cs.filter((c) => c.id !== id))
  }

  const escolherTam = (t) => setTamanho((atual) => (atual === t ? '' : t))

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
          placeholder="Nome (ex: Heineken, Água, Refri)"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <div className="tam-pick">
          <span className="tam-label">Tamanho:</span>
          <button
            className={tamanho === 'Lata' ? 'tam on' : 'tam'}
            onClick={() => escolherTam('Lata')}
          >
            Lata
          </button>
          <button
            className={tamanho === 'Latão' ? 'tam on' : 'tam'}
            onClick={() => escolherTam('Latão')}
          >
            Latão
          </button>
          <span className="tam-dica">(deixe vazio p/ água, refri…)</span>
        </div>
        <div className="form-linha">
          <input
            className="campo campo-preco-novo"
            placeholder="Preço"
            type="number"
            step="0.50"
            inputMode="decimal"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
          />
          <button className="btn-grande" onClick={adicionar}>
            + Add produto
          </button>
        </div>
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
