import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api, qs } from './api';
import type { BoardCardDTO, BoardColumnId, BoardData } from './types';

export interface BoardFilters {
  q?: string;
  range?: string;
  sort?: string;
  dir?: string;
}

/**
 * The website's board API: totals for every status plus a page of cards. With `column` set it
 * loads that one status and pages it ("load more"). Refreshes when the app comes back to the
 * foreground, so statuses stay current as recipients sign.
 */
export function useBoard(column: BoardColumnId | null, filters: BoardFilters, pageSize = 20) {
  const [data, setData] = useState<BoardData | null>(null);
  const [cards, setCards] = useState<BoardCardDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const key = JSON.stringify([column, filters, pageSize]);
  // Loading until the data for the current filters has arrived (or failed).
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const loading = doneKey !== key;
  const [more, setMore] = useState(false);
  const req = useRef(0);

  const load = useCallback(
    async (mode: 'first' | 'refresh') => {
      const id = ++req.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const d = await api<BoardData>(
          `/api/documents/board${qs({ ...filters, column, offset: 0, limit: pageSize })}`,
        );
        if (id !== req.current) return;
        setData(d);
        setCards(d.cards);
        setError(null);
      } catch (err) {
        if (id === req.current) setError((err as Error).message);
      } finally {
        if (id === req.current) {
          setDoneKey(key);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    // The fetch only updates state once it settles, never synchronously here.
    const t = setTimeout(() => void load('first'), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load('refresh');
    });
    return () => sub.remove();
  }, [load]);

  const total = data && column ? data.counts[column] : (data?.total ?? 0);
  const loadMore = useCallback(async () => {
    if (!column || more || !data || cards.length >= total) return;
    setMore(true);
    try {
      const d = await api<BoardData>(
        `/api/documents/board${qs({ ...filters, column, offset: cards.length, limit: pageSize })}`,
      );
      setCards((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...d.cards.filter((c) => !seen.has(c.id))];
      });
      setData((prev) => (prev ? { ...prev, counts: d.counts } : d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column, more, data, cards.length, total, key]);

  return { data, cards, error, loading, refreshing, loadingMore: more, total, refresh: () => load('refresh'), loadMore };
}
