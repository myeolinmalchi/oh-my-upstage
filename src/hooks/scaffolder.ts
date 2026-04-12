/**
 * Fullstack scaffolder: detect fullstack projects from prompt and
 * auto-generate server templates so Solar only needs to customize routes.
 */

const EXPRESS_TEMPLATE = `const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

// Initialize data file
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// TODO: Add your CRUD routes here
// GET /api/items - list all
app.get('/api/items', (req, res) => {
  res.json(readData());
});

// POST /api/items - create
app.post('/api/items', (req, res) => {
  const items = readData();
  const item = { id: Date.now(), ...req.body };
  items.push(item);
  writeData(items);
  res.status(201).json(item);
});

// PUT /api/items/:id - update
app.put('/api/items/:id', (req, res) => {
  const items = readData();
  const idx = items.findIndex(i => i.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  items[idx] = { ...items[idx], ...req.body };
  writeData(items);
  res.json(items[idx]);
});

// DELETE /api/items/:id - delete
app.delete('/api/items/:id', (req, res) => {
  let items = readData();
  items = items.filter(i => i.id !== parseInt(req.params.id));
  writeData(items);
  res.status(204).send();
});

app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
`

const FASTAPI_TEMPLATE = `import sqlite3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "data.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            data TEXT DEFAULT ''
        )
    """)
    conn.commit()
    conn.close()

init_db()

class ItemCreate(BaseModel):
    name: str
    data: Optional[str] = ""

@app.get("/api/items")
def list_items():
    conn = get_db()
    rows = conn.execute("SELECT * FROM items").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/items", status_code=201)
def create_item(item: ItemCreate):
    conn = get_db()
    cur = conn.execute("INSERT INTO items (name, data) VALUES (?, ?)", (item.name, item.data))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return {"id": new_id, "name": item.name, "data": item.data}

@app.put("/api/items/{item_id}")
def update_item(item_id: int, item: ItemCreate):
    conn = get_db()
    conn.execute("UPDATE items SET name=?, data=? WHERE id=?", (item.name, item.data, item_id))
    conn.commit()
    conn.close()
    return {"id": item_id, "name": item.name, "data": item.data}

@app.delete("/api/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    conn = get_db()
    conn.execute("DELETE FROM items WHERE id=?", (item_id,))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
`

/**
 * Detect fullstack from prompt text and generate server template.
 */
export function scaffoldServer(promptText: string, projectDir: string): void {
  try {
    const fs = require("fs")
    const path = require("path")

    const isExpress = promptText.match(/express|node.*서버|node.*server|port\s*3001/i)
    const isFastAPI = promptText.match(/fastapi|python.*서버|python.*server|uvicorn|port\s*8000/i)

    if (!isExpress && !isFastAPI) return

    if (isExpress) {
      const serverPath = path.join(projectDir, "server.js")
      if (!fs.existsSync(serverPath)) {
        fs.writeFileSync(serverPath, EXPRESS_TEMPLATE)
        // Ensure package.json has express and cors
        const pkgPath = path.join(projectDir, "package.json")
        if (!fs.existsSync(pkgPath)) {
          fs.writeFileSync(pkgPath, JSON.stringify({
            name: "server",
            version: "1.0.0",
            dependencies: { express: "^4.18.0", cors: "^2.8.5" }
          }, null, 2))
        }
      }
    }

    if (isFastAPI) {
      const serverPath = path.join(projectDir, "server.py")
      if (!fs.existsSync(serverPath)) {
        fs.writeFileSync(serverPath, FASTAPI_TEMPLATE)
      }
    }
  } catch {}
}
