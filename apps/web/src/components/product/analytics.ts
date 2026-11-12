'use client';

/**
 * Privacy-conscious product analytics. No analytics provider is connected and there is no
 * consent banner yet, so events never leave the browser: they are queued on
 * `window.stAnalytics` and dispatched as an `st:analytics` DOM event for a provider to pick up
 * once consent handling exists. Nothing is recorded when the browser sends Do Not Track or
 * Global Privacy Control. Never pass typed names or other personal data as properties.
 */
export type ProductEvent =
  | 'product_page_viewed'
  | 'hero_cta_clicked'
  | 'feature_section_viewed'
  | 'signature_studio_demo_opened'
  | 'signature_style_selected'
  | 'pricing_cta_clicked'
  | 'api_docs_clicked'
  | 'faq_expanded'
  | 'upload_workflow_started';

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    stAnalytics?: { event: ProductEvent; props: Props; at: number }[];
  }
}

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

export function track(event: ProductEvent, props: Props = {}) {
  if (typeof window === 'undefined' || optedOut()) return;
  const entry = { event, props, at: Date.now() };
  (window.stAnalytics ??= []).push(entry);
  window.dispatchEvent(new CustomEvent('st:analytics', { detail: entry }));
}
