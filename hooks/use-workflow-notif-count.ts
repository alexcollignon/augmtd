import { useState, useEffect } from 'react';

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

  return count;
}
