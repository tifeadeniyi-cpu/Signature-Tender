/** Client-safe shapes for the documents Kanban board. Dates are ISO strings. */

/** Cookies kept here, not in the client components, so server code gets the real strings. */
export const DOCS_VIEW_COOKIE = 'st_docs_view';
export const BOARD_COLLAPSE_COOKIE = 'st_board_collapsed';
export type DocsView = 'kanban' | 'list';

export type BoardColumnId =
  'drafts' | 'sent' | 'in_progress' | 'completed' | 'declined_expired' | 'cancelled';

export type BoardAction =
  | 'details'
  | 'continue_editing'
  | 'view_page'
  | 'send_reminder'
  | 'view_activity'
  | 'cancel_request'
  | 'view_completed'
  | 'download_package'
  | 'download_signed'
  | 'view_certificate'
  | 'view_audit'
  | 'send_again'
  | 'archive';

export interface BoardPerson {
  name: string;
  initials: string;
  /** Signed, Viewed, Waiting, Declined, Gets a copy, or a draft's role. */
  state: string;
}

export interface BoardCardDTO {
  id: string;
  title: string;
  reference: string;
  typeLabel: string;
  column: BoardColumnId;
  /** The exact status, e.g. "Awaiting payment", "Declined", "Expired". */
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  isTest: boolean;
  ownerLabel: string;
  people: BoardPerson[];
  recipientCount: number;
  requiredCount: number;
  requiredDone: number;
  /** The one date that matters for this column, already labelled ("Sent Jan 24, 2026"). */
  dateLabel: string;
  dateIso: string;
  /** Signing deadline while the request is open. */
  dueLabel: string | null;
  dueSoon: boolean;
  requestId: string | null;
  actions: BoardAction[];
  urls: {
    page: string;
    edit: string | null;
    activity: string;
    packageDownload: string | null;
    signedDownload: string | null;
    certificateView: string | null;
  };
}

export interface BoardData {
  counts: Record<BoardColumnId, number>;
  total: number;
  cards: BoardCardDTO[];
  column: BoardColumnId | null;
  offset: number;
  limit: number;
}
