require('dotenv').config()
const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')

const app = express()
app.use(cors())
app.use(express.json())

// ---------------------------------------------------------------------------
// MySQL connection pool
// ---------------------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'ai_website',
  waitForConnections: true,
  connectionLimit: 10,
})

// ---------------------------------------------------------------------------
// Core CRUD functions — these are the "real" functions the AI is allowed
// to trigger. Each one talks to MySQL directly.
// ---------------------------------------------------------------------------
async function listProducts() {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY id')
  return rows
}

async function findProduct(id) {
  const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id])
  return rows[0]
}

async function addProduct({ name, price, stock = 0 }) {
  if (!name || typeof price !== 'number' || price < 0) {
    throw new Error('Invalid product: name and a non-negative price are required')
  }
  const [result] = await pool.query(
    'INSERT INTO products (name, price, stock) VALUES (?, ?, ?)',
    [name, price, stock]
  )
  return findProduct(result.insertId)
}

async function editProduct(id, updates) {
  const product = await findProduct(id)
  if (!product) throw new Error(`Product ${id} not found`)

  const fields = []
  const values = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.price !== undefined) {
    if (typeof updates.price !== 'number' || updates.price < 0) {
      throw new Error('Invalid price')
    }
    fields.push('price = ?')
    values.push(updates.price)
  }
  if (updates.stock !== undefined) {
    fields.push('stock = ?')
    values.push(updates.stock)
  }

  if (fields.length === 0) return product

  values.push(id)
  await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values)
  return findProduct(id)
}

async function removeProduct(id) {
  const product = await findProduct(id)
  if (!product) throw new Error(`Product ${id} not found`)
  await pool.query('DELETE FROM products WHERE id = ?', [id])
  return product
}

// ---------------------------------------------------------------------------
// REST endpoints — plain CRUD, used by the UI's manual edit/remove buttons
// and useful for testing without going through the AI at all.
// ---------------------------------------------------------------------------
app.get('/products', async (req, res) => {
  try {
    res.json(await listProducts())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/products', async (req, res) => {
  try {
    res.status(201).json(await addProduct(req.body))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.put('/products/:id', async (req, res) => {
  try {
    res.json(await editProduct(Number(req.params.id), req.body))
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

app.delete('/products/:id', async (req, res) => {
  try {
    res.json(await removeProduct(Number(req.params.id)))
  } catch (err) {
    res.status(404).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// AI chat endpoint (Gemini) — the model only ever *proposes* a function
// call. We map that proposal onto the same CRUD functions above, after
// validating it. Gemini's function-calling shape differs from OpenAI's:
// tools are "functionDeclarations", and a call comes back as
// candidate.content.parts[].functionCall instead of message.tool_calls.
// ---------------------------------------------------------------------------
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const tools = [
  {
    functionDeclarations: [
      {
        name: 'add_product',
        description: 'Add a new product to the catalog',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number' },
            stock: { type: 'number' },
          },
          required: ['name', 'price'],
        },
      },
      {
        name: 'edit_product',
        description: 'Update an existing product (e.g. change its price)',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
            price: { type: 'number' },
            stock: { type: 'number' },
          },
          required: ['id'],
        },
      },
      {
        name: 'remove_product',
        description: 'Remove a product from the catalog',
        parameters: {
          type: 'object',
          properties: { id: { type: 'number' } },
          required: ['id'],
        },
      },
      {
        name: 'list_products',
        description: 'List all products currently in the catalog',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
]

const systemInstruction = {
  parts: [
    {
      text: 'You manage a product catalog. Use the available tools to add, edit, remove, or list products based on the user request.',
    },
  ],
}

// Maps a tool name to the real function that executes it.
const toolHandlers = {
  add_product: (args) => addProduct(args),
  edit_product: (args) => editProduct(args.id, args),
  remove_product: (args) => removeProduct(args.id),
  list_products: () => listProducts(),
}

// In-memory conversation history per session — Gemini calls this
// "contents", an array of { role: 'user' | 'model' | 'function', parts }.
// Swap for Redis/DB for multiple concurrent users in production.
const conversations = {}

async function callGemini(history) {
  const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINIAI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: history,
      tools,
      systemInstruction,
    }),
  })
  return response.json()
}

app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default', confirm } = req.body

  if (!conversations[sessionId]) {
    conversations[sessionId] = []
  }
  const history = conversations[sessionId]

  // If the frontend is confirming a previously proposed action, execute it
  // directly instead of calling the model again. We also record the
  // function result in history so the model has context on future turns.
  if (confirm) {
    try {
      const result = await toolHandlers[confirm.tool](confirm.args)
      history.push({
        role: 'function',
        parts: [{ functionResponse: { name: confirm.tool, response: { result } } }],
      })
      return res.json({ reply: `Done: ${JSON.stringify(result)}`, executed: true })
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
  }

  history.push({ role: 'user', parts: [{ text: message }] })

  try {
    const data = await callGemini(history)
    const candidate = data.candidates?.[0]

    if (!candidate) {
      return res.status(502).json({ error: 'No response from model', raw: data })
    }

    const parts = candidate.content.parts
    history.push(candidate.content)

    const functionCallPart = parts.find((p) => p.functionCall)
    if (functionCallPart) {
      const { name, args } = functionCallPart.functionCall

      // Read-only call: execute immediately and feed the result back so
      // the model can phrase a natural-language reply.
      if (name === 'list_products') {
        const result = await toolHandlers.list_products()
        history.push({
          role: 'function',
          parts: [{ functionResponse: { name, response: { result } } }],
        })
        return res.json({ reply: `Here are the products: ${JSON.stringify(result)}` })
      }

      // Mutating call: don't execute yet, send back as a proposal that
      // requires explicit user confirmation.
      return res.json({
        proposal: { tool: name, args },
        reply: `Confirm: ${name.replace('_', ' ')} — ${JSON.stringify(args)}`,
      })
    }

    const textPart = parts.find((p) => p.text)
    return res.json({ reply: textPart?.text ?? '(no response)' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Chat request failed' })
  }
})

app.listen(3000, () => {
  console.log('listening on http://localhost:3000')
})