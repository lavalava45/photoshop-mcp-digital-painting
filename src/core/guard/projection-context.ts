export type GuardActiveJobState = 'starting' | 'running' | 'stalled' | 'uncertain';

export interface GuardActiveJobProjection {
  job_id: string;
  state: GuardActiveJobState;
  pid: number | null;
  operation_id: string | null;
  document_id: number | null;
  summary: string | null;
  purpose: string | null;
  stall_reason: string | null;
  heartbeat_age_ms: number | null;
  deadline_at: string | null;
  narrative: Record<string, unknown>;
  poll_command: string;
}

export interface GuardPaintingStateProjection {
  version?: number;
  revision?: number;
  documents?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface GuardOperationProjectionRecord extends Record<string, unknown> {
  id: string;
  phase: string;
  created_at: string;
}

export interface GuardProjectionContext {
  records: GuardOperationProjectionRecord[];
  paintingState: GuardPaintingStateProjection;
  activeJobs: GuardActiveJobProjection[];
  capturedAt: number;
}

export interface GuardProjectionContextOptions {
  records?: GuardOperationProjectionRecord[];
  paintingState?: GuardPaintingStateProjection;
  activeJobs?: GuardActiveJobProjection[];
  capturedAt?: number;
}
