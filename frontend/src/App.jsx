import { useState, useRef, useEffect } from 'react'
import './App.css'

const API_BASE = 'http://localhost:3000'
const SESSION_ID = 'demo-session' // swap for a real per-user id once you have auth

function App() {
  const [products, setProducts] = useState([])
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        "Hi! I can add, edit, or remove products for you. Try: \"add Desk Lamp for $19.99\"",
    },
  ])
  const [input, setInput] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    refreshProducts()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function refreshProducts() {
    try {
      const res = await fetch(`${API_BASE}/products`)
      const data = await res.json()
      setProducts(data)
    } catch (err) {
      console.error('Failed to load products', err)
    }
  }

  function pushMessage(role, content) {
    setMessages((prev) => [...prev, { role, content }])
  }

  // --- Direct CRUD (used by the Edit/Remove buttons, bypasses the AI) -----
  async function editProductDirect(id, price) {
    await fetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price }),
    })
    refreshProducts()
  }

  async function removeProductDirect(id) {
    await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' })
    refreshProducts()
  }

  // --- AI chat -------------------------------------------------------------
  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return

    pushMessage('user', text)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: SESSION_ID }),
      })
      const data = await res.json()

      if (data.error) {
        pushMessage('assistant', `Error: ${data.error}`)
      } else if (data.proposal) {
        setPendingConfirm(data.proposal)
        pushMessage('assistant', data.reply)
      } else {
        pushMessage('assistant', data.reply)
        refreshProducts() // covers list_products / plain replies
      }
    } catch (err) {
      pushMessage('assistant', "Couldn't reach the server. Is server.js running?")
    } finally {
      setLoading(false)
    }
  }

  async function confirmAction() {
    if (!pendingConfirm) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, confirm: pendingConfirm }),
      })
      const data = await res.json()
      pushMessage('assistant', data.error ? `Error: ${data.error}` : data.reply)
      refreshProducts()
    } catch (err) {
      pushMessage('assistant', "Couldn't reach the server.")
    } finally {
      setPendingConfirm(null)
      setLoading(false)
    }
  }

  function cancelAction() {
    pushMessage('assistant', 'Okay, cancelled.')
    setPendingConfirm(null)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Product Console</h1>
        <span className="app-subtitle">Manage inventory by hand, or ask the assistant</span>
      </header>

      <div className="layout">
        {/* --- Product list -------------------------------------------- */}
        <section className="panel products-panel">
          <h2>Products</h2>
          <div className="product-list">
            {products.length === 0 && <p className="empty">No products yet.</p>}
            {products.map((p) => (
              <div className="product-row" key={p.id}>
                <div className="product-info">
                  <span className="product-name">{p.name}</span>
                  <span className="product-meta">
                    ${Number(p.price).toFixed(2)} · {p.stock > 0 ? `${p.stock} in stock` : 'out of stock'}
                  </span>
                </div>
                <div className="product-actions">
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const newPrice = prompt('New price', p.price)
                      if (newPrice) editProductDirect(p.id, parseFloat(newPrice))
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-ghost btn-danger"
                    onClick={() => removeProductDirect(p.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* --- Chat panel ------------------------------------------------ */}
        <section className="panel chat-panel">
          <h2>Assistant</h2>
          <div className="chat-scroll" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble bubble-${m.role}`}>
                {m.content}
              </div>
            ))}

            {pendingConfirm && (
              <div className="confirm-card">
                <button className="btn-confirm" onClick={confirmAction}>Confirm</button>
                <button className="btn-cancel" onClick={cancelAction}>Cancel</button>
              </div>
            )}

            {loading && <div className="bubble bubble-assistant">Thinking…</div>}
          </div>

          <form className="chat-input" onSubmit={handleSend}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="add Desk Lamp for $19.99"
              disabled={loading}
            />
            <button type="submit" disabled={loading}>Send</button>
          </form>
        </section>
      </div>
    </div>
  )
}

export default App