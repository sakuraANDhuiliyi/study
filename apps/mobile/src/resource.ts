import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { MobileClient } from './client';
export function useResource<T>(client: MobileClient, path: string, interval = 0) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ path: string; data?: T; error?: string; loading: boolean }>({
    path,
    loading: true,
  });
  useEffect(() => {
    let active = true,
      busy = false;
    const load = async () => {
      if (busy || AppState.currentState === 'background') return;
      busy = true;
      try {
        const data = await client.request<T>(path);
        if (active) setState({ path, data, loading: false });
      } catch (e) {
        if (active)
          setState((p) => ({
            path,
            data: p.path === path ? p.data : undefined,
            error: (e as Error).message,
            loading: false,
          }));
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = interval ? setInterval(() => void load(), interval) : undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      subscription.remove();
    };
  }, [client, path, interval, version]);
  return {
    ...(state.path === path ? state : { path, loading: true }),
    reload: () => setVersion((v) => v + 1),
  };
}
