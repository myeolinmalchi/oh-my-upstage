import { useState, useEffect } from 'react';

const useRecipes = () => {
  const [recipes, setRecipes] = useState(() => {
    try {
      const stored = localStorage.getItem('recipes');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.warn('Error loading recipes from storage:', error);
      return [];
    }
  });

  const addRecipe = (newRecipe) => {
    setRecipes((prev) => {
      const updated = [...prev, newRecipe];
      localStorage.setItem('recipes', JSON.stringify(updated));
      return updated;
    });
  };

  const updateRecipe = (id, updatedRecipe) => {
    setRecipes((prev) => {
      const foundIndex = prev.findIndex((r) => r.id === id);
      if (foundIndex === -1) return prev;
      const updated = [...prev];
      updated[foundIndex] = updatedRecipe;
      localStorage.setItem('recipes', JSON.stringify(updated));
      return updated;
    });
  };

  const deleteRecipe = (id) => {
    setRecipes((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      localStorage.setItem('recipes', JSON.stringify(updated));
      return updated;
    });
  };

  const findRecipe = (id) => {
    return recipes.find((r) => r.id === id);
  };

  return { recipes, addRecipe, updateRecipe, deleteRecipe, findRecipe };
};

export default useRecipes;