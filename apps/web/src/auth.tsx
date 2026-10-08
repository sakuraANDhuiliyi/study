import { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, User } from './api';
const Context = createContext<{ user?: User; loading: boolean; refresh: () => Promise<any> }>({
  loading: true,
  refresh: async () => {},
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['auth'],
    queryFn: () => api<{ user: User }>('/auth/me'),
    retry: false,
  });
  useEffect(() => {
    const expired = () => client.setQueryData(['auth'], null);
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, [client]);
  return (
    <Context.Provider
      value={{
        user: query.error instanceof ApiError && query.error.status === 401 ? undefined : query.data?.user,
        loading: query.isLoading,
        refresh: () => query.refetch(),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
