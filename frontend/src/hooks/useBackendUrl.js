import { useState, useEffect } from 'react';
import { getBackendUrl } from '../utils/backendConfig';

export function useBackendUrl() {
  const [backendUrl, setBackendUrl] = useState(null);

  useEffect(() => {
    getBackendUrl().then(url => {
      setBackendUrl(url);
    }).catch(error => {
      console.error('Failed to get backend URL:', error);
    });
  }, []);

  return backendUrl;
}
