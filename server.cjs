const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3001;
const dataDir = path.resolve(__dirname, 'data');
const recipesPath = path.join(dataDir, 'recipes.json');

// Ensure data directory exists
fs.mkdirSync(dataDir, { recursive: true });

// Load recipes from file
function loadRecipes() {
  if (fs.existsSync(recipesPath)) {
    const content = fs.readFileSync(recipesPath, 'utf-8');
    return JSON.parse(content);
  }
  return [];
}

// Save recipes to file
function saveRecipes(recipes) {
  fs.writeFileSync(recipesPath, JSON.stringify(recipes, null, 2));
}

// Middleware to serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/recipes', (req, res) => {
  const recipes = loadRecipes();
  res.json(recipes);
});

app.post('/api/recipes', (req, res) => {
  const newRecipe = req.body;
  const recipes = loadRecipes();
  const id = recipes.length > 0 ? recipes[recipes.length - 1].id + 1 : 1;
  const updated = { ...newRecipe, id };
  saveRecipes([...recipes, updated]);
  res.status(201).json(updated);
});

app.put('/api/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updatedRecipe = req.body;
  const recipes = loadRecipes();
  const foundIndex = recipes.findIndex((r) => r.id === id);
  if (foundIndex !== -1) {
    const updated = { ...recipes[foundIndex], ...updatedRecipe };
    saveRecipes([...recipes.slice(0, foundIndex), updated, ...recipes.slice(foundIndex + 1)]);
    res.json(updated);
  } else {
    res.status(404).json({ error: 'Recipe not found' });
  }
});

app.delete('/api/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const recipes = loadRecipes();
  const foundIndex = recipes.findIndex((r) => r.id === id);
  if (foundIndex !== -1) {
    saveRecipes(recipes.filter((r) => r.id !== id));
    res.json({ message: 'Recipe deleted' });
  } else {
    res.status(404).json({ error: 'Recipe not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
