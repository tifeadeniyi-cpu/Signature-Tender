import type { Database, ActorContext } from '@st/db';

/**
 * Connector framework types. A connector is described once (its definition) and, when it is built,
 * has a runtime that does the provider-specific work. Shared services (OAuth, credentials, jobs,
 * mappings, activity, health) live next to this file and are the same for every provider.
 */

/** Whether the marketplace offers the integration. Separate from any one connection's status. */
export type Availability = 'available' | 'beta' | 'coming_soon' | 'maintenance' | 'unavailable';

/** One connection's state. `connecting` exists only in the browser while OAuth is in progress. */
export type ConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'active'
  | 'expired'
  | 'permission_required'
  | 'error'
  | 'disabled';

export type IntegrationCategory =
  | 'Automation'
  | 'CRM & Sales'
  | 'Documents & Storage'
  | 'Productivity'
  | 'Communication'
  | 'Forms'
  | 'E-Commerce'
  | 'HR & Business'
  | 'Partner apps';

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  'Automation',
  'CRM & Sales',
  'Documents & Storage',
  'Productivity',
  'Communication',
  'Forms',
  'E-Commerce',
  'HR & Business',
  'Partner apps',
];

/** What a connector can do. Only capabilities a connector really supports are listed for it. */
export type Capability =
  | 'import_documents'
  | 'send_for_signature'
  | 'send_from_template'
  | 'track_status'
  | 'retrieve_signed'
  | 'save_signed'
  | 'save_certificate'
  | 'trigger_automations'
  | 'sync_activity'
  | 'update_records'
  | 'notifications';

export const CAPABILITY_LABELS: Record<Capability, string> = {
  import_documents: 'Import documents',
  send_for_signature: 'Send for signature',
  send_from_template: 'Send from a template',
  track_status: 'Track signing status',
  retrieve_signed: 'Retrieve signed documents',
  save_signed: 'Save signed documents',
  save_certificate: 'Save Certificates of Completion',
  trigger_automations: 'Trigger automations',
  sync_activity: 'Sync activity',
  update_records: 'Update records',
  notifications: 'Notifications',
};

export interface OAuthConfig {
  type: 'oauth2';
  authorizeUrl: string;
  tokenUrl: string;
  /** Called on disconnect to revoke the grant at the provider, when the provider supports it. */
  revokeUrl?: string;
  scopes: string[];
  scopeSeparator?: string;
  /** Send a PKCE challenge (S256). */
  pkce: boolean;
  /** Extra query parameters for the authorize URL (for example access_type=offline). */
  authorizeParams?: Record<string, string>;
  /** How the client authenticates at the token endpoint. */
  clientAuth: 'body' | 'basic';
  /** Hosts the connector may call with the user's token. Anything else is refused. */
  apiHosts: string[];
}

export type AuthConfig =
  | OAuthConfig
  /** Partner calls our API with a key issued at connect time (Beam Artist, Jectstack). */
  | { type: 'partner_api_key' }
  /** We post to a Slack incoming webhook. */
  | { type: 'slack_webhook' }
  /** Built on a third-party platform that holds the user's Signature Tender credential (Zapier, Make). */
  | { type: 'platform' }
  | { type: 'none' };

export interface ConnectorTrigger {
  /** A Signature Tender event type (see WEBHOOK_EVENTS). */
  event: string;
  label: string;
}

export interface ConnectorAction {
  key: string;
  label: string;
  description: string;
  /** Events this action can run on in an automation. Empty means manual only. */
  runsOn: string[];
}

export interface ConnectorDefinition {
  key: string;
  name: string;
  /** The company that makes the app. */
  provider: string;
  category: IntegrationCategory;
  description: string;
  /** Marketplace roadmap phase from the spec (1 = priority). */
  roadmapPhase: 1 | 2 | 3 | 0;
  /** Availability before any admin override. */
  availability: Availability;
  /**
   * True only when the connector's code is built and tested. Unbuilt connectors are always shown as
   * Coming Soon and cannot be connected, whatever an admin override says.
   */
  implemented: boolean;
  capabilities: Capability[];
  auth: AuthConfig;
  /** Plain-language consent text shown before connecting. */
  access: {
    reads: string[];
    writes: string[];
    copiesSignedDocuments: boolean;
    revoke: string;
  };
  triggers: ConnectorTrigger[];
  actions: ConnectorAction[];
  setup: string[];
  /** Logo under /public, from the provider's official brand assets. Null shows the app's initials. */
  logo: string | null;
  /** Personal accounts allowed (members connect their own account). */
  allowsPersonal: boolean;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: Date | null;
  scopes: string[];
}

export interface ExternalAccount {
  id: string;
  label: string;
}

/** A provider error, classified so the job runner and health checks know what to do. */
export class IntegrationError extends Error {
  constructor(
    public readonly code:
      | 'auth_expired'
      | 'permission_revoked'
      | 'rate_limited'
      | 'provider_unavailable'
      | 'invalid_record'
      | 'not_found'
      | 'not_configured'
      | 'mapping_error'
      | 'upload_failed'
      | 'invalid_request'
      | 'internal',
    message: string,
    public readonly options: { retryable?: boolean; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'IntegrationError';
  }

  get retryable(): boolean {
    if (this.options.retryable !== undefined) return this.options.retryable;
    return this.code === 'rate_limited' || this.code === 'provider_unavailable';
  }

  /** The connection status this error implies, if it says something about the connection. */
  get connectionStatus(): 'expired' | 'permission_required' | 'error' | null {
    if (this.code === 'auth_expired') return 'expired';
    if (this.code === 'permission_revoked') return 'permission_required';
    return null;
  }
}

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;

/** What a running action gets: a token-holding client limited to the connector's hosts. */
export interface ActionContext {
  /** For actions that read or write Signature Tender records, always as `actor`. */
  db: Database;
  actor: ActorContext;
  connectionId: string;
  workspaceId: string;
  actorUserId: string;
  /** Calls the provider with the connection's access token (refreshed when needed). */
  call: (url: string, init?: RequestInit) => Promise<Response>;
  input: Record<string, unknown>;
  documentId: string | null;
  requestId: string | null;
  correlationId: string | null;
}

export interface ActionResult {
  output?: Record<string, unknown>;
  externalReference?: string;
  message?: string;
}

/** Provider-specific code. Only built connectors have one. */
export interface ConnectorRuntime {
  /** Who the token belongs to, used to label the connection. */
  fetchAccount(call: ActionContext['call']): Promise<ExternalAccount>;
  /** A cheap authenticated call used by "Test connection" and health checks. */
  validate?(call: ActionContext['call']): Promise<void>;
  actions: Record<string, (ctx: ActionContext) => Promise<ActionResult>>;
}
