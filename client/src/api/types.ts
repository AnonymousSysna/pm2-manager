export type ApiResult<T> = {
  success: boolean;
  data: T;
  error: string | null;
};

export type Pagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type ProcessSummary = {
  id: number;
  name: string;
  cwd: string;
  pid: number;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  port: number | string | null;
  mode: "fork" | "cluster";
};

export type DeploymentHistoryItem = {
  ts: string;
  processName: string;
  actor?: string;
  action?: string;
  success: boolean;
  branch?: string | null;
  restartMode?: "restart" | "reload";
  targetCommit?: string | null;
  error?: string | null;
  steps?: Array<{
    label: string;
    success: boolean;
    durationMs?: number;
    output?: string;
    error?: string;
  }>;
};

export type RestartHistoryItem = {
  ts: string;
  processName: string;
  event: string;
  source?: string;
  actor?: string;
};

export type AuditHistoryItem = {
  ts: string;
  action: string;
  actor?: string;
  ip?: string;
  processName?: string;
  success?: boolean;
  error?: string | null;
  details?: Record<string, unknown> | null;
};

export type PagedResult<T> = {
  items: T[];
  pagination: Pagination;
};
