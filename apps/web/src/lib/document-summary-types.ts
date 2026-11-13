/**
 * Shape of the document details drawer's data. Built on the server from row-level-security
 * checked loaders; every date is an ISO string so it crosses the network unchanged.
 */

export type DrawerStatus =
  | 'completed'
  | 'in_progress'
  | 'pending'
  | 'draft'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'needs_attention';

export type SignerStatus =
  | 'signed'
  | 'approved'
  | 'reviewed'
  | 'pending'
  | 'viewed'
  | 'declined'
  | 'not_started'
  | 'expired'
  | 'cancelled'
  | 'copy';

/** Actions the server has confirmed this person may take on this document right now. */
export type DrawerAction =
  | 'download_signed'
  | 'view_document'
  | 'view_certificate'
  | 'download_certificate'
  | 'send_reminder'
  | 'cancel_request'
  | 'continue_editing'
  | 'send_again'
  | 'retry_finalize';

export interface DrawerSigner {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  order: number;
  status: SignerStatus;
  statusLabel: string;
  authLabel: string;
  viewedAt: string | null;
  doneAt: string | null;
  declineReason: string | null;
  reminders: number;
}

export interface DrawerActivity {
  id: string;
  at: string;
  type: string;
  title: string;
  description: string | null;
  actor: string;
  tone: 'success' | 'error' | 'info' | 'neutral';
  icon: 'file' | 'send' | 'mail' | 'eye' | 'pen' | 'check' | 'x' | 'download' | 'shield' | 'edit';
}

export interface DrawerFile {
  id: string;
  kind: 'original' | 'signed' | 'certificate' | string;
  label: string;
  filename: string;
  type: string;
  sizeBytes: number;
  createdAt: string;
  sha256: string;
  viewUrl: string | null;
  downloadUrl: string | null;
}

export interface DocumentSummary {
  id: string;
  reference: string;
  title: string;
  typeLabel: string;
  status: DrawerStatus;
  statusLabel: string;
  isTest: boolean;
  archived: boolean;
  purged: boolean;
  createdBy: string | null;
  createdByYou: boolean;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  expiresAt: string | null;
  pageCount: number | null;
  /** People who must act (signers, approvers, reviewers). CC and viewers only get a copy. */
  actionableCount: number;
  actionableDone: number;
  recipientCount: number;
  signingOrder: boolean;
  requestId: string | null;
  signers: DrawerSigner[];
  activity: DrawerActivity[];
  files: DrawerFile[];
  evidence: {
    available: boolean;
    certificateNumber: string | null;
    verificationRef: string | null;
    eventCount: number;
    consentCount: number;
    signedCount: number;
    originalSha256: string | null;
    signedSha256: string | null;
    certificateViewUrl: string | null;
    certificateDownloadUrl: string | null;
  };
  urls: {
    page: string;
    edit: string | null;
    signedDownload: string | null;
    /** Signed agreement + Certificate of Completion. */
    packageDownload: string | null;
    documentView: string | null;
  };
  actions: DrawerAction[];
  access: 'manage' | 'view';
}
