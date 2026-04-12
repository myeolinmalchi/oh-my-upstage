import { useState, useEffect } from 'react';
import useRecipes from './hooks/useRecipes';

const RecipeForm = ({ onCreate, onUpdate }) => {
  const [title, setTitle] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [instructions, setInstructions] = useState('');
  const [editingId, setEditingId] = useState(null);
  const { recipes } = useRecipes();

  useEffect(() => {
    if (onUpdate) {
      const recipe = recipes.find((r) => r.id === onUpdate.id);
      if (recipe) {
        setTitle(recipe.title);
        setIngredients(recipe.ingredients);
        setInstructions(recipe.instructions);
        setEditingId(onUpdate.id);
      }
    }
  }, [onUpdate, recipes]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onUpdate) {
      onCreate?.({ id: editingId, title, ingredients, instructions });
    } else {
      const newId = recipes.length > 0 ? recipes[recipes.length - 1].id + 1 : 1;
      onCreate?.({ id: newId, title, ingredients, instructions });
    }
  };

  return (
    <form className="recipe-form" onSubmit={handleSubmit}>
      <h2>{editingId ? '레시피 수정' : '레시피 추가'}</h2>
      <input
        type="text"
        placeholder="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        placeholder="재료 목록 (쉼표로 구분)"
        value={ingredients}
        onChange={(e) => setIngredients(e.target.value)}
        rows={2}
      ></textarea>
      <textarea
        placeholder="조리 방법"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={4}
      ></textarea>
      <button type="submit">저장</button>
    </form>
  );
};

export default RecipeForm;