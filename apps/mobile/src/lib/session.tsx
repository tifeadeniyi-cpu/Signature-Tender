import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authClient } from './auth';
import { api, onSessionEnded, setWorkspace } from './api';
import type { Me } from './types';

const WORKSPACE_KEY = 'signature-tender.workspace';

type State =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; me: Me };

interface SessionValue {
  state: State;
  reload: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

/**
 * Who is signed in and which workspace the app shows. The Better Auth session decides whether
 * someone is signed in; /api/mobile/me then says who they are and what they may do.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const saved = await SecureStore.getItemAsync(WORKSPACE_KEY);
      setWorkspace(saved);
      const me = await api<Me>('/api/mobile/me');
      setWorkspace(me.workspace?.id ?? null);
      setState({ status: 'ready', me });
    } catch (err) {
      const e = err as { status?: number; message: string };
      setState(e.status === 401 ? { status: 'signed_out' } : { status: 'error', message: e.message });
    }
  }, []);

  const userId = session.data?.user?.id ?? null;
  // Load the profile whenever a different person signs in.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (session.isPending || !userId || loadedFor === userId) return;
    const t = setTimeout(() => {
      setLoadedFor(userId);
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [session.isPending, userId, loadedFor, load]);
  useEffect(() => {
    if (!session.isPending && !userId) setWorkspace(null);
  }, [session.isPending, userId]);
  const current = useMemo<State>(
    () =>
      session.isPending
        ? { status: 'loading' }
        : !userId
          ? { status: 'signed_out' }
          : loadedFor !== userId
            ? { status: 'loading' }
            : state,
    [session.isPending, userId, loadedFor, state],
  );

  useEffect(() => {
    onSessionEnded(() => setState({ status: 'signed_out' }));
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      state: current,
      reload: load,
      switchWorkspace: async (id) => {
        await SecureStore.setItemAsync(WORKSPACE_KEY, id);
        setWorkspace(id);
        await load();
      },
      signOut: async () => {
        await authClient.signOut().catch(() => undefined);
        await SecureStore.deleteItemAsync(WORKSPACE_KEY).catch(() => undefined);
        setWorkspace(null);
        setState({ status: 'signed_out' });
        setLoadedFor(null);
      },
    }),
    [current, load],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

/** The signed-in profile; only call on screens behind the signed-in layout. */
export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== 'ready') throw new Error('Not signed in');
  return state.me;
}
