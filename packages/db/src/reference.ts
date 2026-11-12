/**
 * Reference data: the permission catalogue, system roles, launch pricing and feature flags.
 * Seeded idempotently in every environment. Prices are launch configuration targets (spec Part 3)
 * and can be changed later in the database without a code change.
 */

export const PERMISSIONS = {
  'workspace.manage': 'Edit workspace details and settings',
  'billing.manage': 'Manage billing, credits and subscriptions',
  'team.view': 'View team members',
  'team.manage': 'Invite, remove and change roles of members',
  'roles.manage': 'Create and edit custom roles',
  'documents.view_all': 'View all workspace documents',
  'documents.view_own': 'View documents you created',
  'documents.create': 'Create and edit drafts',
  'documents.send': 'Send documents for signature',
  'documents.delete': 'Delete or void documents',
  'templates.view': 'View templates',
  'templates.manage': 'Create and edit templates',
  'contacts.view': 'View contacts',
  'contacts.manage': 'Create and edit contacts',
  'integrations.manage': 'Connect and configure integrations',
  'api.manage': 'Manage API keys and webhooks',
  'audit.view': 'View workspace audit history',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

export const SYSTEM_ROLES: Record<
  | 'owner'
  | 'admin'
  | 'manager'
  | 'editor'
  | 'viewer'
  | 'billing_admin'
  | 'api_developer'
  | 'signer',
  { name: string; description: string; permissions: PermissionKey[] }
> = {
  owner: {
    name: 'Owner',
    description: 'Full access, including billing and ownership',
    permissions: ALL,
  },
  admin: {
    name: 'Admin',
    description: 'Full access to workspace settings, team and documents',
    permissions: ALL,
  },
  manager: {
    name: 'Manager',
    description: 'Create, edit and send documents; manage templates and contacts',
    permissions: [
      'team.view',
      'documents.view_all',
      'documents.view_own',
      'documents.create',
      'documents.send',
      'templates.view',
      'templates.manage',
      'contacts.view',
      'contacts.manage',
      'audit.view',
    ],
  },
  editor: {
    name: 'Editor',
    description: 'Create and edit drafts; cannot send',
    permissions: [
      'documents.view_own',
      'documents.create',
      'templates.view',
      'contacts.view',
      'contacts.manage',
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access to workspace documents',
    permissions: [
      'team.view',
      'documents.view_all',
      'documents.view_own',
      'templates.view',
      'contacts.view',
    ],
  },
  billing_admin: {
    name: 'Billing Administrator',
    description: 'Manage billing, credits and invoices; view own documents',
    permissions: ['billing.manage', 'team.view', 'documents.view_own'],
  },
  api_developer: {
    name: 'API Developer',
    description: 'Manage API keys, webhooks and integrations',
    permissions: ['api.manage', 'integrations.manage', 'documents.view_own', 'templates.view'],
  },
  signer: {
    name: 'Signer',
    description: 'Can sign documents sent to them; no workspace management',
    permissions: [],
  },
};

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const LAUNCH_PLANS = [
  {
    code: 'payg',
    name: 'Pay As You Go',
    monthlyPriceCents: 0,
    includedRequests: null,
    overagePriceCents: 299,
    isCustom: false,
    sortOrder: 0,
    description: 'No subscription. Pay once per signing request.',
  },
  {
    code: 'starter',
    name: 'Starter',
    monthlyPriceCents: 999,
    includedRequests: 10,
    overagePriceCents: 149,
    isCustom: false,
    sortOrder: 1,
    description: 'For occasional senders.',
  },
  {
    code: 'business',
    name: 'Business',
    monthlyPriceCents: 2499,
    includedRequests: 35,
    overagePriceCents: 99,
    isCustom: false,
    sortOrder: 2,
    description: 'For growing businesses.',
  },
  {
    code: 'team',
    name: 'Team',
    monthlyPriceCents: 4999,
    includedRequests: 100,
    overagePriceCents: 69,
    isCustom: false,
    sortOrder: 3,
    description: 'For teams that send every day.',
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    monthlyPriceCents: null,
    includedRequests: null,
    overagePriceCents: null,
    isCustom: true,
    sortOrder: 4,
    description: 'Custom volume, terms and support.',
  },
] as const;

export const LAUNCH_PRICES = [
  {
    code: 'single_request',
    name: 'Single signing request',
    credits: 1,
    amountCents: 299,
    sortOrder: 0,
  },
  { code: 'bundle_5', name: '5 prepaid credits', credits: 5, amountCents: 1299, sortOrder: 1 },
  { code: 'bundle_10', name: '10 prepaid credits', credits: 10, amountCents: 2299, sortOrder: 2 },
  { code: 'bundle_25', name: '25 prepaid credits', credits: 25, amountCents: 4999, sortOrder: 3 },
  {
    code: 'bundle_100',
    name: '100 prepaid credits',
    credits: 100,
    amountCents: 14999,
    sortOrder: 4,
  },
] as const;

export const FEATURE_FLAGS = [
  {
    key: 'production_signing',
    description:
      'Allow real signing requests to be sent. Off until security and legal release gates pass.',
    enabled: false,
  },
  {
    key: 'guest_sending',
    description: 'Allow one-time senders without a full account (Phase 2).',
    enabled: false,
  },
  { key: 'payments', description: 'Stripe checkout and credits (Phase 4).', enabled: false },
  { key: 'passkeys', description: 'Passkey sign-in and registration.', enabled: true },
  {
    key: 'retention_deletion',
    description:
      'Allow removing stored files for records past their retention period. Off until the retention policy has legal sign-off.',
    enabled: false,
  },
  {
    key: 'test_signing',
    description:
      'Allow free test signing requests, clearly marked as tests, in development and test environments only.',
    enabled: true,
    environments: ['development', 'test'],
  },
  {
    key: 'public_api',
    description:
      'Accept requests to the public REST API (/api/v1) and deliver webhooks. Off in production until the owner turns it on.',
    enabled: true,
    environments: ['development', 'test', 'staging'],
  },
] as const;

export const APP_CONFIG = [
  {
    key: 'limits.max_signers_per_request',
    value: 5,
    description: 'Maximum signers included in one signing request',
  },
  { key: 'limits.max_upload_mb', value: 25, description: 'Maximum PDF upload size in megabytes' },
  { key: 'limits.max_pages', value: 200, description: 'Maximum pages in an uploaded PDF' },
  {
    key: 'legal.esign_disclosure',
    value: {
      version: 'draft-2026-11-12',
      text: 'DRAFT: pending attorney review.\n\nYou are being asked to review and sign this document electronically. By selecting "I agree", you consent to use electronic records and signatures for this document instead of paper.\n\nWhat you need: a device with a current web browser and an email address you can access.\n\nYour copy: when everyone has signed, you will receive an email with a link to download the completed document, if the sender allows downloads. Ask the sender if you need another copy.\n\nPaper option: you may decline to sign electronically by choosing "Decline to sign" and contacting the sender to arrange another way to sign.\n\nWithdrawing consent: you can withdraw before you finish signing by declining. Withdrawing does not affect anything you already signed electronically.',
    },
    description:
      'Electronic records and signature disclosure shown before signing. Must be replaced with counsel-approved text before production.',
  },
  {
    key: 'legal.specialized_documents',
    value: {
      version: 'draft-2026-11-12',
      intro:
        'DRAFT: pending attorney review. Some documents need formalities that electronic signing may not meet, such as witnesses, notarization or filing on paper. Do not send these here unless you have confirmed electronic signing is allowed for them.',
      categories: [
        'Wills, codicils and testamentary trusts',
        'Adoption, divorce and other family law matters',
        'Court orders, notices and official court documents',
        'Notices of cancellation or termination of utility services, health or life insurance',
        'Notices of default, foreclosure, eviction or repossession of a primary residence',
        'Product recall or safety notices',
        'Documents that must be notarized, witnessed or recorded (for example some real estate deeds)',
        'Regulated medical or financial records with their own signature rules',
      ],
      confirm:
        'This document is not one of these, or I have confirmed that electronic signing is allowed for it.',
    },
    description:
      'Documents that may need extra formalities. Senders must confirm before a real send; the confirmation and this version are recorded in the evidence log. Must be reviewed by counsel before production.',
  },
  {
    key: 'signing.link_valid_days',
    value: 30,
    description: 'How long a recipient link stays valid when the request has no expiration date',
  },
  {
    key: 'billing.cancel_credit_policy',
    value: 'restore_if_unopened',
    description:
      'What happens to the credit when a sent request is cancelled: restore_if_unopened gives it back if no recipient has opened the request yet; never keeps it used',
  },
  {
    key: 'retention.default_days',
    value: 2555,
    description:
      'Launch default for keeping completed records (about 7 years) when a workspace sets no policy. Pending legal review',
  },
  {
    key: 'retention.min_days',
    value: 365,
    description: 'Shortest retention period a workspace may choose',
  },
  {
    key: 'retention.deleted_draft_days',
    value: 30,
    description: 'How long deleted drafts can be restored before they are eligible for removal',
  },
  {
    key: 'api.rate_limit_per_minute',
    value: 120,
    description: 'Requests one API key may make per minute',
  },
  {
    key: 'api.max_json_kb',
    value: 256,
    description: 'Largest JSON request body the API accepts, in kilobytes',
  },
  {
    key: 'api.embedded_session_minutes',
    value: 15,
    description: 'How long an embedded signing link stays valid',
  },
  {
    key: 'webhooks.max_attempts',
    value: 8,
    description:
      'Delivery attempts before a webhook is marked failed for good (about 32 minutes of retries at 8)',
  },
  {
    key: 'support.email',
    value: 'support@signaturetender.com',
    description: 'Support contact shown in the app',
  },
] as const;
