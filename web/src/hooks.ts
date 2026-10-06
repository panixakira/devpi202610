import { useCallback, useEffect, useState } from 'react';

/** API からの読み込み状態を管理する */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    return load().then(setData, (e: Error) => setError(e.message));
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, error, reload };
}
