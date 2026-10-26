import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, type MeDto, type Permission, type Portal, type Role } from '@vta/shared';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { cachedMe, claimForUser, wipeAll } from '../offline/store';
import { api, ApiError, setCsrfToken } from './api';

/** `offline` is set when the server cannot be reached and a trainer's details kept on the phone are used instead. */
export type Me = MeDto & { offline?: boolean };

interface AuthState {
  me: Me | null;
  loading: boolean;
  roles: Role[];
  can: (p: Permission) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api.get<MeDto>('/auth/me');
        setCsrfToken(me.csrfToken);
        // Keeps a trainer's details for opening the app offline; deletes another person's offline data.
        await claimForUser(me).catch(() => undefined);
        return me as Me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        // No connection: a trainer can still open the app and take attendance (UI only; the server checks every request).
        if (e instanceof ApiError && e.status === 0) {
          const cached = await cachedMe().catch(() => null);
          if (cached) return { ...cached, csrfToken: '', offline: true } as Me;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  // When the connection comes back, check the sign-in again (and get a fresh CSRF token).
  useEffect(() => {
    const back = () => void qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [qc]);

  const me = data ?? null;
  const roles = me ? [...new Set(me.roles.map((r) => r.role))] : [];

  const value: AuthState = {
    me,
    loading: isLoading,
    roles,
    // UI hint only. The API checks every request on its own.
    can: (p) => hasPermission(roles, p),
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.refetchQueries({ queryKey: ['me'] });
    },
    signOut: async () => {
      try {
        await api.post('/auth/logout');
      } finally {
        // TR-09: nothing from this account stays on the phone after sign-out.
        await wipeAll().catch(() => undefined);
        setCsrfToken('');
        qc.clear();
        window.location.assign('/login');
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const PORTAL_PATH: Record<Portal, string> = {
  admin: '/admin',
  employer: '/employer',
  learn: '/learn',
  partner: '/partner',
};

/** Where to send a user after sign-in: their only portal, or the switcher if they have several. */
export function homePathFor(me: Me): string {
  if (me.portals.length === 1) return PORTAL_PATH[me.portals[0]!];
  if (me.portals.length === 0) return '/no-access';
  return '/choose-portal';
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
