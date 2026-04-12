import { useState, useEffect } from 'react';

const useLocalStorage = (key, defaultValue) => {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch (error) {
      console.warn('Error initializing local storage:', error);
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Error saving to local storage:', error);
    }
  }, [key, value]);

  return [value, setValue];
};

export default useLocalStorage;