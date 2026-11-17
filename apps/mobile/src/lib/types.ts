export type { BoardAction, BoardCardDTO, BoardColumnId, BoardData } from './shared/board-types';
export type { DocumentSummary } from './shared/document-summary-types';

export interface Me {
  user: { id: string; name: string; email: string; image: string | null };
  workspaces: { id: string; name: string; role: string }[];
  workspace: { id: string; name: string; role: string } | null;
  can: { create: boolean; send: boolean };
}
