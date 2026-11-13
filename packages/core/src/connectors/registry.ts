import type {
  Availability,
  ConnectorDefinition,
  ConnectorRuntime,
  IntegrationCategory,
  Capability,
} from './types';

/**
 * The integrations catalogue. `implemented: false` entries are roadmap targets: the marketplace
 * shows them as Coming Soon and nothing can connect to them. A connector is switched to
 * `implemented: true` only in the pull request that builds and tests it.
 */

const STORAGE_ACCESS = {
  reads: ['Files you choose to import (not the rest of your storage)'],
  writes: ['Signed documents and certificates, only to folders you choose'],
  copiesSignedDocuments: true,
  revoke:
    'Disconnect here, or remove Signature Tender from the connected apps page of your account with the provider.',
};

const CRM_ACCESS = {
  reads: ['Records you select (deals, contacts, companies) and the fields you map'],
  writes: ['Signing status and, if you turn it on, the signed agreement on the linked record'],
  copiesSignedDocuments: true,
  revoke: 'Disconnect here, or uninstall Signature Tender from the provider account.',
};

const AUTOMATION_ACCESS = {
  reads: ['Envelope status and events for the workflows you build'],
  writes: ['Envelopes your workflows send, charged like any other send'],
  copiesSignedDocuments: false,
  revoke: 'Turn off the workflow on the platform, or revoke its API key in Settings → Developers.',
};

function planned(
  key: string,
  name: string,
  provider: string,
  category: IntegrationCategory,
  description: string,
  roadmapPhase: 1 | 2 | 3,
  capabilities: Capability[],
  access: ConnectorDefinition['access'],
): ConnectorDefinition {
  return {
    key,
    name,
    provider,
    category,
    description,
    roadmapPhase,
    availability: 'coming_soon',
    implemented: false,
    capabilities,
    auth: { type: 'none' },
    access,
    triggers: [],
    actions: [],
    setup: [],
    logo: null,
    allowsPersonal: false,
  };
}

const STATUS_TRIGGERS = [
  { event: 'request.sent', label: 'Envelope sent' },
  { event: 'recipient.viewed', label: 'Envelope viewed' },
  { event: 'recipient.signed', label: 'Recipient signed' },
  { event: 'request.completed', label: 'Envelope completed' },
  { event: 'request.declined', label: 'Envelope declined' },
  { event: 'request.expired', label: 'Envelope expired' },
];

export const CONNECTORS: ConnectorDefinition[] = [
  // ---- Working today (built in Phase 7 of the platform) --------------------------------------
  {
    key: 'beam_artist',
    name: 'Beam Artist',
    provider: 'Beam Artist',
    category: 'Partner apps',
    description:
      'Send booking agreements and contracts for signature from Beam Artist and get status back by webhook.',
    roadmapPhase: 0,
    availability: 'available',
    implemented: true,
    capabilities: ['send_for_signature', 'track_status', 'retrieve_signed'],
    auth: { type: 'partner_api_key' },
    access: {
      reads: ['Documents and requests created with the connection key'],
      writes: ['Documents and signing requests Beam Artist sends'],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here. The connection key is revoked straight away.',
    },
    triggers: STATUS_TRIGGERS,
    actions: [],
    setup: [
      'Click Connect and optionally paste the Beam Artist webhook URL.',
      'Copy the API key shown once and paste it into Beam Artist.',
    ],
    logo: null,
    allowsPersonal: false,
  },
  {
    key: 'jectstack',
    name: 'Jectstack',
    provider: 'Jectstack',
    category: 'Partner apps',
    description:
      'Send project agreements for signature from Jectstack and keep a reference to the signed record.',
    roadmapPhase: 0,
    availability: 'available',
    implemented: true,
    capabilities: ['send_for_signature', 'track_status', 'retrieve_signed'],
    auth: { type: 'partner_api_key' },
    access: {
      reads: ['Documents and requests created with the connection key'],
      writes: ['Documents and signing requests Jectstack sends'],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here. The connection key is revoked straight away.',
    },
    triggers: STATUS_TRIGGERS,
    actions: [],
    setup: [
      'Click Connect and optionally paste the Jectstack webhook URL.',
      'Copy the API key shown once and paste it into Jectstack.',
    ],
    logo: null,
    allowsPersonal: false,
  },
  {
    key: 'slack',
    name: 'Slack',
    provider: 'Slack',
    category: 'Communication',
    description:
      'Post to a Slack channel when documents are sent, signed, completed, declined, expired or cancelled. Messages carry the document title and a link, never its contents.',
    roadmapPhase: 0,
    availability: 'available',
    implemented: true,
    capabilities: ['notifications', 'track_status'],
    auth: { type: 'slack_webhook' },
    access: {
      reads: [],
      writes: ['A message in the channel you chose, with the document title and a link'],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here, or remove the incoming webhook in Slack.',
    },
    triggers: [],
    actions: [],
    setup: [
      'In Slack, create an incoming webhook for the channel you want.',
      'Paste the webhook URL here and click Connect. A hello message confirms it works.',
    ],
    logo: null,
    allowsPersonal: false,
  },

  // ---- Roadmap phase 1 -----------------------------------------------------------------------
  {
    key: 'google_drive',
    name: 'Google Drive',
    provider: 'Google',
    category: 'Documents & Storage',
    description:
      'Send Drive files for signature and save signed agreements and certificates back to a Drive folder.',
    roadmapPhase: 1,
    availability: 'coming_soon',
    implemented: false,
    capabilities: [
      'import_documents',
      'send_for_signature',
      'track_status',
      'save_signed',
      'save_certificate',
    ],
    auth: {
      type: 'oauth2',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      // drive.file: only files the user picks or the app creates. No access to the rest of Drive.
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
      pkce: true,
      authorizeParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
      clientAuth: 'body',
      apiHosts: ['www.googleapis.com', 'openidconnect.googleapis.com'],
    },
    access: STORAGE_ACCESS,
    triggers: [],
    actions: [
      {
        key: 'drive.save_completed',
        label: 'Save signed copy to Drive',
        description: 'Save the signed PDF, certificate or combined file to a Drive folder.',
        runsOn: ['document.available'],
      },
    ],
    setup: [],
    logo: null,
    allowsPersonal: true,
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    provider: 'HubSpot',
    category: 'CRM & Sales',
    description:
      'Send agreements from deals and contacts, fill templates with CRM fields and attach signed copies to the record.',
    roadmapPhase: 1,
    availability: 'coming_soon',
    implemented: false,
    capabilities: [
      'send_from_template',
      'track_status',
      'save_signed',
      'update_records',
      'sync_activity',
    ],
    auth: {
      type: 'oauth2',
      authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      scopes: [
        'oauth',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
        'crm.objects.contacts.read',
        'crm.objects.companies.read',
        'files',
      ],
      scopeSeparator: ' ',
      pkce: false,
      clientAuth: 'body',
      apiHosts: ['api.hubapi.com'],
    },
    access: CRM_ACCESS,
    triggers: [],
    actions: [
      {
        key: 'hubspot.attach_completed',
        label: 'Attach signed agreement to the deal',
        description: 'Attach the signed PDF to the linked HubSpot record.',
        runsOn: ['document.available'],
      },
      {
        key: 'hubspot.update_deal',
        label: 'Update a deal property',
        description: 'Set a deal property you choose when the agreement completes.',
        runsOn: ['request.completed'],
      },
    ],
    setup: [],
    logo: null,
    allowsPersonal: false,
  },
  {
    key: 'zapier',
    name: 'Zapier',
    provider: 'Zapier',
    category: 'Automation',
    description:
      'Send documents and templates for signature from thousands of apps, and start Zaps when envelopes are signed or completed.',
    roadmapPhase: 1,
    availability: 'coming_soon',
    implemented: false,
    capabilities: [
      'send_for_signature',
      'send_from_template',
      'retrieve_signed',
      'trigger_automations',
    ],
    auth: { type: 'platform' },
    access: AUTOMATION_ACCESS,
    triggers: STATUS_TRIGGERS,
    actions: [],
    setup: [],
    logo: null,
    allowsPersonal: false,
  },

  // ---- Roadmap phase 2 -----------------------------------------------------------------------
  planned(
    'make',
    'Make',
    'Make',
    'Automation',
    'Build Make scenarios that send envelopes and react when they are signed, completed or declined.',
    2,
    ['send_for_signature', 'send_from_template', 'retrieve_signed', 'trigger_automations'],
    AUTOMATION_ACCESS,
  ),
  planned(
    'pipedrive',
    'Pipedrive',
    'Pipedrive',
    'CRM & Sales',
    'Send agreements from Pipedrive deals and attach signed copies when they complete.',
    2,
    ['send_from_template', 'track_status', 'save_signed', 'update_records'],
    CRM_ACCESS,
  ),
  planned(
    'jotform',
    'Jotform',
    'Jotform',
    'Forms',
    'Turn form submissions into agreements sent for signature from a template.',
    2,
    ['send_from_template', 'track_status'],
    {
      reads: ['Submissions of the forms you choose and the fields you map'],
      writes: [],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here, or remove the integration in Jotform.',
    },
  ),
  planned(
    'onedrive',
    'Microsoft OneDrive',
    'Microsoft',
    'Documents & Storage',
    'Send OneDrive files for signature and save signed copies to a OneDrive folder.',
    2,
    ['import_documents', 'send_for_signature', 'save_signed', 'save_certificate'],
    STORAGE_ACCESS,
  ),
  planned(
    'outlook',
    'Microsoft Outlook',
    'Microsoft',
    'Productivity',
    'Send email attachments for signature and share signed documents from Outlook.',
    2,
    ['import_documents', 'send_for_signature', 'track_status'],
    {
      reads: ['Attachments of messages you choose'],
      writes: [],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here, or remove the app in your Microsoft account.',
    },
  ),

  // ---- Roadmap phase 3 -----------------------------------------------------------------------
  planned(
    'salesforce',
    'Salesforce',
    'Salesforce',
    'CRM & Sales',
    'Send agreements from Salesforce records and keep signing status on the record.',
    3,
    ['send_from_template', 'track_status', 'save_signed', 'update_records'],
    CRM_ACCESS,
  ),
  planned(
    'sharepoint',
    'Microsoft SharePoint',
    'Microsoft',
    'Documents & Storage',
    'Send from SharePoint libraries and archive signed files with metadata.',
    3,
    ['import_documents', 'send_for_signature', 'save_signed', 'update_records'],
    STORAGE_ACCESS,
  ),
  planned(
    'power_automate',
    'Microsoft Power Automate',
    'Microsoft',
    'Automation',
    'Use Signature Tender actions and triggers in Power Automate flows.',
    3,
    ['send_for_signature', 'send_from_template', 'trigger_automations'],
    AUTOMATION_ACCESS,
  ),
  planned(
    'shopify',
    'Shopify',
    'Shopify',
    'E-Commerce',
    'Send wholesale, vendor and service agreements when a business event happens in your store. Never added to ordinary checkout.',
    3,
    ['send_from_template', 'track_status'],
    {
      reads: ['The customer or company record of the event you choose'],
      writes: [],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here, or uninstall the app from your Shopify admin.',
    },
  ),
  planned(
    'woocommerce',
    'WooCommerce',
    'WooCommerce',
    'E-Commerce',
    'Send supplier and wholesale agreements from WooCommerce events.',
    3,
    ['send_from_template', 'track_status'],
    {
      reads: ['The customer or order record of the event you choose'],
      writes: [],
      copiesSignedDocuments: false,
      revoke: 'Disconnect here, or remove the plugin key in WooCommerce.',
    },
  ),
  planned(
    'monday',
    'monday.com',
    'monday.com',
    'Productivity',
    'Send agreements from board items and update their status when signed.',
    3,
    ['send_from_template', 'track_status', 'update_records'],
    CRM_ACCESS,
  ),
  planned(
    'clickup',
    'ClickUp',
    'ClickUp',
    'Productivity',
    'Link signing requests to ClickUp tasks and update them when agreements complete.',
    3,
    ['track_status', 'update_records'],
    CRM_ACCESS,
  ),
  planned(
    'asana',
    'Asana',
    'Asana',
    'Productivity',
    'Link signing requests to Asana tasks and complete them when agreements are signed.',
    3,
    ['track_status', 'update_records'],
    CRM_ACCESS,
  ),
  planned(
    'dropbox',
    'Dropbox',
    'Dropbox',
    'Documents & Storage',
    'Import documents from Dropbox and save signed copies to a folder.',
    3,
    ['import_documents', 'send_for_signature', 'save_signed', 'save_certificate'],
    STORAGE_ACCESS,
  ),
  planned(
    'box',
    'Box',
    'Box',
    'Documents & Storage',
    'Import documents from Box and save signed copies to a folder.',
    3,
    ['import_documents', 'send_for_signature', 'save_signed', 'save_certificate'],
    STORAGE_ACCESS,
  ),
  planned(
    'n8n',
    'n8n',
    'n8n',
    'Automation',
    'Use Signature Tender in n8n workflows with envelope actions and triggers.',
    3,
    ['send_for_signature', 'send_from_template', 'trigger_automations'],
    AUTOMATION_ACCESS,
  ),
  planned(
    'zoho_crm',
    'Zoho CRM',
    'Zoho',
    'CRM & Sales',
    'Send agreements from Zoho CRM deals and attach signed copies.',
    3,
    ['send_from_template', 'track_status', 'save_signed', 'update_records'],
    CRM_ACCESS,
  ),
];

/**
 * Brand logos served from apps/web/public/integrations/logos. They are the brands' own marks,
 * unmodified and in their own colours, used only to identify the app (from the CC0 gilbarbara/logos
 * and Simple Icons collections). Apps without a mark those collections may redistribute (Outlook,
 * SharePoint, Power Automate, Jotform), Pipedrive (wordmark only, unreadable at tile size) and our
 * partners keep the initials tile.
 */
const LOGOS = new Set([
  'slack',
  'google_drive',
  'hubspot',
  'zapier',
  'make',
  'onedrive',
  'salesforce',
  'shopify',
  'woocommerce',
  'monday',
  'clickup',
  'asana',
  'dropbox',
  'box',
  'n8n',
  'zoho_crm',
]);
for (const c of CONNECTORS) if (LOGOS.has(c.key)) c.logo = `/integrations/logos/${c.key}.svg`;

export function getConnector(key: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.key === key);
}

// ---------------------------------------------------------------------------------------------
// Runtimes: provider code, registered by the connector's own module once it is built.

const runtimes = new Map<string, ConnectorRuntime>();

export function registerConnectorRuntime(key: string, runtime: ConnectorRuntime) {
  runtimes.set(key, runtime);
}

export function getConnectorRuntime(key: string): ConnectorRuntime | undefined {
  return runtimes.get(key);
}

/** Test support: add a definition (for a fake provider) and remove it afterwards. */
export function registerConnectorForTests(def: ConnectorDefinition, runtime: ConnectorRuntime) {
  if (CONNECTORS.some((c) => c.key === def.key))
    throw new Error(`Connector ${def.key} already exists`);
  CONNECTORS.push(def);
  runtimes.set(def.key, runtime);
  return () => {
    const i = CONNECTORS.findIndex((c) => c.key === def.key);
    if (i >= 0) CONNECTORS.splice(i, 1);
    runtimes.delete(def.key);
  };
}

// ---------------------------------------------------------------------------------------------
// Availability.

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** Reads a provider's OAuth client from the server environment. */
export type OAuthClientLookup = (providerKey: string) => OAuthClient | null;

export interface ResolvedAvailability {
  availability: Availability;
  /** True when a member with permission could connect it right now. */
  connectable: boolean;
  /** Why it cannot be connected, for admins and support. */
  reason: 'not_built' | 'setup_required' | 'disabled_by_admin' | 'feature_off' | null;
}

const ADMIN_STATES: Availability[] = [
  'available',
  'beta',
  'coming_soon',
  'maintenance',
  'unavailable',
];

/**
 * Works out what the marketplace shows: unbuilt connectors are always Coming Soon; an admin can
 * pause or hide a built one; an OAuth connector without its provider app credentials cannot connect.
 */
export function resolveAvailability(
  def: ConnectorDefinition,
  overrides: Record<string, unknown>,
  opts: { oauthClient: OAuthClientLookup; featureEnabled: boolean },
): ResolvedAvailability {
  if (!def.implemented)
    return { availability: 'coming_soon', connectable: false, reason: 'not_built' };
  const o = overrides[def.key];
  const availability =
    typeof o === 'string' && ADMIN_STATES.includes(o as Availability)
      ? (o as Availability)
      : def.availability;
  if (availability !== 'available' && availability !== 'beta')
    return { availability, connectable: false, reason: 'disabled_by_admin' };
  if (def.auth.type === 'oauth2') {
    if (!opts.featureEnabled) return { availability, connectable: false, reason: 'feature_off' };
    if (!opts.oauthClient(def.key))
      return { availability, connectable: false, reason: 'setup_required' };
  }
  if (def.auth.type === 'platform' || def.auth.type === 'none')
    return { availability, connectable: false, reason: null };
  return { availability, connectable: true, reason: null };
}
