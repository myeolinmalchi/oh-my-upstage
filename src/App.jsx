import './App.css';
import { useState, useEffect } from 'react';
import useRecipes from './hooks/useRecipes';
import RecipeForm from './components/RecipeForm';
import RecipeCard from './components/RecipeCard';

const App = () => {
  const { recipes, addRecipe, updateRecipe, deleteRecipe, findRecipe } = useRecipes();
  const [editingRecipe, setEditingRecipe] = useState(null);

  const handleAdd = (newRecipe) => {
    addRecipe(newRecipe);
  };

  const handleUpdate = (updatedRecipe) => {
    if (editingRecipe && editingRecipe.id === updatedRecipe.id) {
      setEditingRecipe(updatedRecipe);
    }
  };

  const handleEdit = (recipe) => {
    setEditingRecipe(recipe);
  };

  const handleDelete = (id) => {
    deleteRecipe(id);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>레시피 북</h1>
      </header>
      <main>
        <RecipeForm onCreate={handleAdd} onUpdate={handleUpdate} />
        <section className="recipes-list">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          ))}
        </section>
      </main>
    </div>
  );
};

export default App;
