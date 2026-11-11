import type { ToolId } from './tools';

export type Bin = 'in' | 'out';

// Authorship ledger. hand = made by the designer, ai = raw machine output,
// mixed = machine output the designer has worked over (or the reverse).
export type Origin = 'hand' | 'mixed' | 'ai';

export interface Asset {
  id: string;
  blobId: string; // file bytes live in the "blobs" store; records can share one
  name: string;
  mime: string;
  size: number;
  tool: ToolId;
  bin: Bin;
  origin: Origin;
  projectId: string; // '' = unassigned
  tags: string[];
  note: string;
  createdAt: number;
  parentId?: string; // lineage: the asset this one was made from
  seq?: number; // order in the CapCut sequence
}

export interface Note {
  id: string;
  tool: ToolId;
  title: string;
  body: string;
  projectId: string;
  createdAt: number;
}

export type ProjectStatus = 'BRIEF' | 'ACTIVE' | 'REVIEW' | 'DELIVERED';
export const PROJECT_STATUSES: ProjectStatus[] = ['BRIEF', 'ACTIVE', 'REVIEW', 'DELIVERED'];

export interface Project {
  id: string;
  name: string;
  client: string;
  status: ProjectStatus;
  due: string; // yyyy-mm-dd or ''
  createdAt: number;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  BRIEF: 'Brief',
  ACTIVE: 'In progress',
  REVIEW: 'In review',
  DELIVERED: 'Delivered',
};

export const ORIGINS: Origin[] = ['hand', 'mixed', 'ai'];

export const ORIGIN_LABEL: Record<Origin, string> = {
  hand: 'Hand',
  mixed: 'AI + Hand',
  ai: 'AI',
};
