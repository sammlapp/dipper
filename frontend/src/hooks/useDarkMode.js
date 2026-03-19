import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'dipper_dark_mode';

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return stored === 'true';
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  // Apply class to body whenever darkMode changes
  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
  }, [darkMode]);

  // Sync across components (ReviewTab toolbar ↔ SettingsTab) via storage events
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) {
        setDarkMode(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      // Trigger storage event for other hook instances in the same tab
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: String(next) }));
      return next;
    });
  }, []);

  const set = useCallback((value) => {
    setDarkMode(value);
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch {}
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: String(value) }));
  }, []);

  return { darkMode, toggle, set };
}
