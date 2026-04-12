import { useEffect, useState } from 'react';
import useRecipes from '../hooks/useRecipes';

const RecipeCard = ({ recipe, onDelete, onEdit }) => {
  const handleDelete = () => onDelete(recipe.id);
  const handleEdit = () => onEdit(recipe);

  return (
    <div className="recipe-card">
      <div className="recipe-card-header">
        <h3 className="card-title">{recipe.title}</h3>
        <div className="card-actions">
          <button className="edit-button" onClick={handleEdit}>
            수정
          </button>
          <button className="delete-button" onClick={handleDelete}>
            삭제
          </button>
        </div>
      </div>
      <div className="recipe-details">
        {recipe.ingredients && typeof recipe.ingredients === 'string' && recipe.ingredients.split(',').map((ing, i) => (
          <p key={i}>{ing.trim()}</p>
        ))}
        {recipe.instructions && typeof recipe.instructions === 'string' && recipe.instructions.split('.').map((inst, i) => (
          <p key={i + 10000}>{inst.trim()}</p>
        ))}
      </div>
    </div>
  );
};

export default RecipeCard;