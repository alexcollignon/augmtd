import { useState, useEffect, useCallback } from 'react';

export function useWorkflowNotifCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/notifications/workflows')
        .then(r => r.json())
        .then(d => setCount(d.count ?? 0))
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const markAllRead = useCallback(() => {
    if (count === 0) return;
    setCount(0);
    fetch('/api/notifications/workflows/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, [count]);

  return { count, markAllRead };
}
