require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();

app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ai_website",
    waitForConnections: true,
    connectionLimit: 10,
});

async function listProducts() {
    const [rows] = await pool.query(
        "SELECT * FROM products ORDER BY id"
    );

    return rows;
}

async function findProduct(id) {
    const [rows] = await pool.query(
        "SELECT * FROM products WHERE id = ?",
        [id]
    );

    return rows[0];
}

async function addProduct({ name, price, stock = 0 }) {
    if (!name || typeof price !== "number" || price < 0) {
        throw new Error(
            "Invalid product: name and a non-negative price are required."
        );
    }

    const [result] = await pool.query(
        "INSERT INTO products (name, price, stock) VALUES (?, ?, ?)",
        [name, price, stock]
    );

    return findProduct(result.insertId);
}

async function editProduct(id, updates) {
    const product = await findProduct(id);

    if (!product) {
        throw new Error(`Product ${id} not found.`);
    }

    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
        fields.push("name = ?");
        values.push(updates.name);
    }

    if (updates.price !== undefined) {
        if (typeof updates.price !== "number" || updates.price < 0) {
            throw new Error("Invalid price.");
        }

        fields.push("price = ?");
        values.push(updates.price);
    }

    if (updates.stock !== undefined) {
        fields.push("stock = ?");
        values.push(updates.stock);
    }

    if (fields.length === 0) {
        return product;
    }

    values.push(id);

    await pool.query(
        `UPDATE products SET ${fields.join(", ")} WHERE id = ?`,
        values
    );

    return findProduct(id);
}

async function removeProduct(id) {
    const product = await findProduct(id);

    if (!product) {
        throw new Error(`Product ${id} not found.`);
    }

    await pool.query(
        "DELETE FROM products WHERE id = ?",
        [id]
    );

    return product;
}

app.get("/products", async (req, res) => {
    try {
        const products = await listProducts();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/products", async (req, res) => {
    try {
        const product = await addProduct(req.body);
        res.status(201).json(product);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put("/products/:id", async (req, res) => {
    try {
        const product = await editProduct(
            Number(req.params.id),
            req.body
        );

        res.json(product);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

app.delete("/products/:id", async (req, res) => {
    try {
        const product = await removeProduct(
            Number(req.params.id)
        );

        res.json(product);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

// =========================

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});