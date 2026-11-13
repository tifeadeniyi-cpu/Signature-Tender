// Client-safe: no database or Node imports. Used by the marketplace UI in the browser.
import type { ApiScope } from './api';

/**
 * The integrations catalogue (Integrations Marketplace). `available: true` means connection code
 * exists in this codebase; everything else is listed as Coming Soon and cannot be connected.
 * Whether an available integration can be used right now (configured, switched on by staff) is
 * worked out at runtime by `resolveAvailability`. Availability and a workspace's connection
 * status are separate: an integration can be available but not connected.
 */
export const INTEGRATION_CATEGORIES = [
  'Automation',
  'CRM & Sales',
  'Documents & Storage',
  'Productivity',
  'Forms',
  'E-Commerce',
  'HR & Business',
  'Communication',
  'Partner apps',
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export const INTEGRATION_CAPABILITIES = {
  import_documents: 'Import documents',
  send_for_signature: 'Send for signature',
  send_from_template: 'Send from template',
  track_status: 'Track signing status',
  retrieve_signed: 'Retrieve signed documents',
  save_signed: 'Save signed documents',
  save_certificates: 'Save Certificates of Completion',
  trigger_automations: 'Trigger automations',
  notifications: 'Post notifications',
  sync_activity: 'Sync activity',
} as const;
export type IntegrationCapability = keyof typeof INTEGRATION_CAPABILITIES;

export type IntegrationAvailability =
  'available' | 'beta' | 'coming_soon' | 'unavailable' | 'maintenance';
export type IntegrationConnectionState =
  'not_connected' | 'connecting' | 'connected' | 'expired' | 'error' | 'disconnected';

export interface IntegrationInfo {
  key: string;
  name: string;
  /** The company behind the app. */
  provider: string;
  category: IntegrationCategory;
  description: string;
  /** Connection code exists. False = Coming Soon. */
  available: boolean;
  /** Newly built: works, but still labelled Beta. */
  beta?: boolean;
  /** `api`: the partner calls our API with a key. `slack`: we post to a Slack webhook. `oauth`: we hold the user's authorization. */
  kind?: 'api' | 'slack' | 'oauth';
  /** Scopes the connection's API key gets (`api` kind). */
  scopes?: ApiScope[];
  /** What the integration does. Only capabilities the connector really supports. */
  capabilities: IntegrationCapability[];
  /** What the app can access, in plain words, shown before connecting. */
  access?: string[];
  /** Setup steps shown on the details page. */
  setup?: string[];
  /** Feature flag staff can switch off; when off the integration shows as Maintenance. */
  featureFlag?: string;
  /** Roadmap phase for Coming Soon entries. */
  phase?: 1 | 2 | 3;
  note?: string;
}

const PARTNER_SCOPES: ApiScope[] = [
  'documents:read',
  'documents:write',
  'requests:send',
  'files:read',
  'embedded:sign',
];

const soon = (
  key: string,
  name: string,
  provider: string,
  category: IntegrationCategory,
  description: string,
  capabilities: IntegrationCapability[],
  phase: 1 | 2 | 3,
  note?: string,
): IntegrationInfo => ({
  key,
  name,
  provider,
  category,
  description,
  capabilities,
  available: false,
  phase,
  note,
});

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    key: 'google_drive',
    name: 'Google Drive',
    provider: 'Google',
    category: 'Documents & Storage',
    description:
      'Import PDFs and Google Docs from Drive to send for signature, and save signed copies and Certificates of Completion back to a Drive folder.',
    available: true,
    beta: true,
    kind: 'oauth',
    featureFlag: 'integration_google_drive',
    capabilities: ['import_documents', 'send_for_signature', 'save_signed', 'save_certificates'],
    access: [
      'Only the files you pick in the Google Drive file picker, and files Signature Tender creates. It cannot browse or read the rest of your Drive.',
      'Your Google account name and email address, to show which account is connected.',
      'When auto-save is on, signed documents and certificates are copied to the Drive folder you choose. Anyone with access to that folder can open them.',
    ],
    setup: [
      'Click Connect and choose the Google account to use.',
      'To send a Drive file, choose Import from Google Drive on the New document page.',
      'Optionally turn on auto-save and pick a folder for signed copies.',
      'Disconnect at any time here or in your Google Account settings.',
    ],
  },
  {
    key: 'beam_artist',
    name: 'Beam Artist',
    provider: 'Beam Artist',
    category: 'Partner apps',
    description:
      'Send booking agreements and contracts for signature from Beam Artist and get status back by webhook.',
    available: true,
    kind: 'api',
    scopes: PARTNER_SCOPES,
    capabilities: ['send_for_signature', 'track_status', 'retrieve_signed'],
    access: [
      'An API key limited to documents, sending, completed files and embedded signing in this workspace.',
      'Status updates sent to the webhook address you enter.',
    ],
  },
  {
    key: 'jectstack',
    name: 'Jectstack',
    provider: 'Jectstack',
    category: 'Partner apps',
    description:
      'Send project agreements for signature from Jectstack and keep a reference to the signed record.',
    available: true,
    kind: 'api',
    scopes: PARTNER_SCOPES,
    capabilities: ['send_for_signature', 'track_status', 'retrieve_signed'],
    access: [
      'An API key limited to documents, sending, completed files and embedded signing in this workspace.',
      'Status updates sent to the webhook address you enter.',
    ],
  },
  {
    key: 'slack',
    name: 'Slack',
    provider: 'Slack',
    category: 'Communication',
    description:
      'Post to a Slack channel when documents are sent, signed, completed, declined, expired or cancelled. Messages carry the document title and a link, never its contents.',
    available: true,
    kind: 'slack',
    capabilities: ['notifications', 'track_status'],
    access: ['Posts messages to the one Slack channel whose incoming webhook you paste.'],
  },
  soon(
    'zapier',
    'Zapier',
    'Zapier',
    'Automation',
    'Send documents from any Zap and start Zaps when documents are sent, viewed, signed, completed, declined or expired.',
    ['send_for_signature', 'send_from_template', 'retrieve_signed', 'trigger_automations'],
    1,
    'Our Zapier app is in development and not yet published by Zapier. Until then, Webhooks by Zapier can call the Signature Tender API and receive its webhooks.',
  ),
  soon(
    'hubspot',
    'HubSpot',
    'HubSpot',
    'CRM & Sales',
    'Send agreements from HubSpot deals and contacts, fill templates from CRM fields and attach signed agreements to the record.',
    ['send_from_template', 'track_status', 'save_signed'],
    1,
  ),
  soon(
    'make',
    'Make',
    'Make',
    'Automation',
    'Create and send documents in Make scenarios and watch for completed, signed or declined documents.',
    ['send_for_signature', 'send_from_template', 'retrieve_signed', 'trigger_automations'],
    2,
  ),
  soon(
    'pipedrive',
    'Pipedrive',
    'Pipedrive',
    'CRM & Sales',
    'Send agreements from Pipedrive deals and attach the signed PDF.',
    ['send_from_template', 'track_status', 'save_signed'],
    2,
  ),
  soon(
    'jotform',
    'Jotform',
    'Jotform',
    'Forms',
    'Turn form submissions into agreements filled from the answers.',
    ['send_from_template', 'trigger_automations'],
    2,
  ),
  soon(
    'onedrive',
    'Microsoft OneDrive',
    'Microsoft',
    'Documents & Storage',
    'Import files from OneDrive and save signed copies and certificates to a folder.',
    ['import_documents', 'save_signed', 'save_certificates'],
    2,
  ),
  soon(
    'outlook',
    'Microsoft Outlook',
    'Microsoft',
    'Productivity',
    'Send email attachments for signature and share signed documents from Outlook.',
    ['import_documents', 'send_for_signature', 'track_status'],
    2,
  ),
  soon(
    'salesforce',
    'Salesforce',
    'Salesforce',
    'CRM & Sales',
    'Send agreements from Salesforce records.',
    ['send_from_template', 'track_status', 'save_signed'],
    3,
  ),
  soon(
    'sharepoint',
    'Microsoft SharePoint',
    'Microsoft',
    'Documents & Storage',
    'Send from document libraries and archive signed files with metadata.',
    ['import_documents', 'save_signed'],
    3,
  ),
  soon(
    'power_automate',
    'Microsoft Power Automate',
    'Microsoft',
    'Automation',
    'Use Signature Tender actions and triggers in Power Automate flows.',
    ['send_for_signature', 'trigger_automations'],
    3,
  ),
  soon(
    'shopify',
    'Shopify',
    'Shopify',
    'E-Commerce',
    'Send vendor, wholesale and service agreements when business events happen in your store. Never added to ordinary checkout.',
    ['send_from_template', 'track_status'],
    3,
  ),
  soon(
    'woocommerce',
    'WooCommerce',
    'Automattic',
    'E-Commerce',
    'Send wholesale and supplier agreements from WooCommerce events.',
    ['send_from_template', 'track_status'],
    3,
  ),
  soon(
    'monday',
    'monday.com',
    'monday.com',
    'Productivity',
    'Send agreements from boards and track status on items.',
    ['send_from_template', 'track_status'],
    3,
  ),
  soon(
    'clickup',
    'ClickUp',
    'ClickUp',
    'Productivity',
    'Send agreements from tasks and attach signed copies.',
    ['send_from_template', 'save_signed'],
    3,
  ),
  soon(
    'asana',
    'Asana',
    'Asana',
    'Productivity',
    'Send agreements from tasks and track signing status.',
    ['send_from_template', 'track_status'],
    3,
  ),
  soon(
    'dropbox',
    'Dropbox',
    'Dropbox',
    'Documents & Storage',
    'Import documents and save signed copies to Dropbox.',
    ['import_documents', 'save_signed'],
    3,
  ),
  soon(
    'box',
    'Box',
    'Box',
    'Documents & Storage',
    'Import documents and save signed copies to Box.',
    ['import_documents', 'save_signed'],
    3,
  ),
  soon(
    'n8n',
    'n8n',
    'n8n',
    'Automation',
    'Use Signature Tender nodes in n8n workflows.',
    ['send_for_signature', 'trigger_automations'],
    3,
  ),
  soon(
    'zoho_crm',
    'Zoho CRM',
    'Zoho',
    'CRM & Sales',
    'Send agreements from Zoho CRM deals and contacts.',
    ['send_from_template', 'track_status'],
    3,
  ),
  soon(
    'stripe',
    'Stripe',
    'Stripe',
    'E-Commerce',
    'Collect payment from recipients as part of signing.',
    [],
    3,
    'Signature Tender uses Stripe for its own billing. Connecting your own Stripe account is not available yet.',
  ),
];

/**
 * What a marketplace card should say about an integration right now. `configured` is whether the
 * deployment has the provider credentials it needs (OAuth apps); `flagEnabled` is the staff switch.
 */
export function resolveAvailability(
  info: IntegrationInfo,
  opts: { configured?: boolean; flagEnabled?: boolean } = {},
): IntegrationAvailability {
  if (!info.available) return 'coming_soon';
  if (info.kind === 'oauth' && opts.configured === false) return 'unavailable';
  if (info.featureFlag && opts.flagEnabled === false) return 'maintenance';
  return info.beta ? 'beta' : 'available';
}

/** Whether a Connect button may be shown and used. */
export function canConnect(availability: IntegrationAvailability) {
  return availability === 'available' || availability === 'beta';
}

/** A workspace's connection state for the marketplace, from the stored connection row. */
export function connectionState(
  c: { status: string; lastErrorAt?: Date | null; lastSuccessAt?: Date | null } | null | undefined,
): IntegrationConnectionState {
  if (!c) return 'not_connected';
  if (c.status === 'disabled') return 'disconnected';
  if (c.status === 'expired') return 'expired';
  if (c.status === 'error') return 'error';
  if (c.lastErrorAt && (!c.lastSuccessAt || c.lastErrorAt > c.lastSuccessAt)) return 'error';
  return 'connected';
}

/** Marketplace search over name, provider, category, description and capabilities. */
export function searchIntegrations(list: IntegrationInfo[], query: string, category?: string) {
  const q = query.trim().toLowerCase();
  return list.filter((i) => {
    if (category && category !== 'all' && i.category !== category) return false;
    if (!q) return true;
    const hay = [
      i.name,
      i.provider,
      i.category,
      i.description,
      ...i.capabilities.map((c) => INTEGRATION_CAPABILITIES[c]),
    ]
      .join(' ')
      .toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}
