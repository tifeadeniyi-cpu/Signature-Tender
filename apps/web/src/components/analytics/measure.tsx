'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  classifySource,
  isTrafficSource,
  pageGroup,
  type TrafficSource,
} from '@st/core/measurement';
import { optedOut } from '@/components/product/analytics';

/**
 * Privacy-first measurement in the browser. No cookies, local storage or identifiers: a visit is
 * counted from the page load itself, only coarse categories are sent, and nothing is sent when
 * the browser asks not to be tracked (Global Privacy Control or Do Not Track).
 */

const SOURCE_PARAM = 'st_src';

// Where this visit came from, kept only in memory for the life of the page (so it carries from a
// landing page to the sign-up form within the same visit, and is gone when the tab closes).
let visitSource: TrafficSource | null = null;
let visitCounted = false;

function post(path: string, body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(path, new Blob([json], { type: 'application/json' }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => undefined);
}

function navigationType(): string {
  const nav = performance.getEntriesByType?.('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  return nav?.type ?? 'navigate';
}

/** Counts one visit per page load that arrives from outside the site. Reloads don't count. */
export function VisitBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    if (visitCounted || optedOut()) return;
    visitCounted = true;
    const fromOutside =
      !document.referrer || new URL(document.referrer).host !== window.location.host;
    if (!fromOutside || navigationType() !== 'navigate') return;
    visitSource = classifySource({
      referrer: document.referrer,
      url: window.location.href,
      ownHost: window.location.host,
    });
    post('/api/t/visit', { page: pageGroup(pathname), source: visitSource });
  }, [pathname]);
  return null;
}

/**
 * Adds this visit's source category to a post-sign-up URL, so it can be recorded once the new
 * account is signed in. Returns the URL unchanged when tracking is off or the source is unknown.
 */
export function withSignupSource(url: string): string {
  if (typeof window === 'undefined' || optedOut() || !visitSource) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set(SOURCE_PARAM, visitSource);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** Records the source carried in the URL after sign-up, then removes it from the address bar. */
export function SignupSourceRecorder() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const src = url.searchParams.get(SOURCE_PARAM);
    if (src === null) return;
    url.searchParams.delete(SOURCE_PARAM);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (!optedOut() && isTrafficSource(src)) post('/api/t/source', { source: src });
  }, []);
  return null;
}

const TICK_S = 15;
const IDLE_MS = 60_000;
const SEND_AT_S = 60;

/**
 * Active time in the app: counted only while the tab is visible and focused and the person has
 * used the page in the last minute. An idle or background tab adds nothing. Sent in small
 * batches; the server also caps it by the time that has actually passed.
 */
export function ActiveTime() {
  useEffect(() => {
    if (optedOut()) return;
    let last = Date.now();
    let pending = 0;
    const touch = () => {
      last = Date.now();
    };
    const flush = () => {
      if (pending >= TICK_S) post('/api/t/active', { seconds: pending });
      pending = 0;
    };
    const tick = window.setInterval(() => {
      const active =
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        Date.now() - last < IDLE_MS;
      if (active) pending += TICK_S;
      if (pending >= SEND_AT_S) flush();
    }, TICK_S * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const events = [
      'pointerdown',
      'keydown',
      'scroll',
      'wheel',
      'touchstart',
      'mousemove',
    ] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(tick);
      for (const e of events) window.removeEventListener(e, touch);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
  return null;
}
