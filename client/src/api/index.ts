import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import type {
  ApiResult,
  AuditHistoryItem,
  DeploymentHistoryItem,
  PagedResult,
  ProcessSummary,
  RestartHistoryItem
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHeaders = Record<string, any>;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  withCredentials: true
});

function isAuthEndpoint(url: string | undefined): boolean {
  const value = String(url || "");
  return (
    value.includes("/api/v1/auth/login") ||
    value.includes("/api/v1/auth/refresh") ||
    value.includes("/api/v1/auth/me") ||
    value.includes("/api/v1/auth/logout") ||
    value.includes("/api/auth/login") ||
    value.includes("/api/auth/refresh") ||
    value.includes("/api/auth/me") ||
    value.includes("/api/auth/logout")
  );
}

function isAuthMeEndpoint(url: string | undefined): boolean {
  const value = String(url || "");
  return (
    value.includes("/api/v1/auth/me") ||
    value.includes("/api/auth/me")
  );
}

function getCookie(name: string): string {
  const cookie = document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const method = String(config.method || "get").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = getCookie("pm2_csrf");
    if (csrf) {
      const headers = (config.headers || {}) as AnyHeaders;
      headers["x-csrf-token"] = csrf;
      config.headers = headers as any;
    }
  }
  return config;
});

const unwrap = <T>(response: AxiosResponse<ApiResult<T>>): ApiResult<T> => response.data;
let refreshPromise: Promise<ApiResult<{ refreshed: boolean }>> | null = null;

async function refreshSession(): Promise<ApiResult<{ refreshed: boolean }>> {
  if (!refreshPromise) {
    refreshPromise = api
      .post<ApiResult<{ refreshed: boolean }>>("/api/v1/auth/refresh")
      .then((response) => response.data)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error?.response?.status;
    const requestUrl = error?.config?.url;
    const onLoginRoute = window.location.pathname.startsWith("/login");
    const originalConfig = (error?.config || {}) as InternalAxiosRequestConfig & { _retry?: boolean };

    if (status === 401 && (!isAuthEndpoint(requestUrl) || isAuthMeEndpoint(requestUrl))) {
      if (originalConfig._retry) {
        if (!onLoginRoute) {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }

      originalConfig._retry = true;
      return refreshSession()
        .then((result) => {
          if (!result?.success) {
            throw new Error(result?.error || "Session refresh failed");
          }
          return api.request(originalConfig);
        })
        .catch((refreshError) => {
          if (!onLoginRoute) {
            window.location.href = "/login";
          }
          return Promise.reject(refreshError);
        });
    }
    return Promise.reject(error);
  }
);

export const auth = {
  login: (username: string, password: string) =>
    api.post<ApiResult<{ authenticated: boolean }>>("/api/v1/auth/login", { username, password }).then(unwrap),
  me: () => api.get<ApiResult<{ authenticated: boolean; user?: { username: string | null } }>>("/api/v1/auth/me").then(unwrap),
  logout: () => api.post<ApiResult<{ loggedOut: boolean }>>("/api/v1/auth/logout").then(unwrap),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<ApiResult<{ updated: boolean }>>("/api/v1/auth/change-password", { currentPassword, newPassword }).then(unwrap)
};

export const processes = {
  list: () => api.get<ApiResult<ProcessSummary[]>>("/api/v1/processes").then(unwrap),
  catalog: () => api.get<ApiResult<any>>("/api/v1/processes/catalog").then(unwrap),
  interpreters: () => api.get<ApiResult<any>>("/api/v1/processes/interpreters").then(unwrap),
  installInterpreter: (key: string) =>
    api.post<ApiResult<any>>("/api/v1/processes/interpreters/install", { key }).then(unwrap),
  nodeRuntimeStatus: () => api.get<ApiResult<any>>("/api/v1/processes/runtimes/node").then(unwrap),
  installNodeRuntime: (version: string, manager = "") =>
    api.post<ApiResult<any>>("/api/v1/processes/runtimes/node/install", { version, manager }).then(unwrap),
  monitoringSummary: () => api.get<ApiResult<any[]>>("/api/v1/processes/monitoring/summary").then(unwrap),
  setMeta: (name: string, payload: Record<string, unknown>) =>
    api.patch<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/meta`, payload).then(unwrap),
  clearMeta: (name: string) => api.delete<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/meta`).then(unwrap),
  metrics: (name: string, limit = 120) =>
    api.get<ApiResult<any[]>>(`/api/v1/processes/${encodeURIComponent(name)}/metrics?limit=${limit}`).then(unwrap),
  exportConfig: () => api.get<ApiResult<any>>("/api/v1/processes/config/export").then(unwrap),
  importConfig: (payload: Record<string, unknown>) => api.post<ApiResult<any>>("/api/v1/processes/config/import", payload).then(unwrap),
  deploymentHistory: (limit: number | string = 100, processName = "", forceFresh = false) =>
    api
      .get<ApiResult<DeploymentHistoryItem[]>>(
        `/api/v1/processes/history/deployments?limit=${encodeURIComponent(String(limit))}${
          processName ? `&process=${encodeURIComponent(processName)}` : ""
        }${forceFresh ? `&_ts=${Date.now()}` : ""}`
      )
      .then(unwrap),
  deploymentHistoryPage: (page = 1, pageSize = 25, processName = "", forceFresh = false) =>
    api
      .get<ApiResult<PagedResult<DeploymentHistoryItem>>>(
        `/api/v1/processes/history/deployments?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}${
          processName ? `&process=${encodeURIComponent(processName)}` : ""
        }${forceFresh ? `&_ts=${Date.now()}` : ""}`
      )
      .then(unwrap),
  restartHistoryPage: (page = 1, pageSize = 25, processName = "", event = "", forceFresh = false) =>
    api
      .get<ApiResult<PagedResult<RestartHistoryItem>>>(
        `/api/v1/processes/history/restarts?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}${
          processName ? `&process=${encodeURIComponent(processName)}` : ""
        }${event ? `&event=${encodeURIComponent(event)}` : ""}${forceFresh ? `&_ts=${Date.now()}` : ""}`
      )
      .then(unwrap),
  auditHistoryPage: (page = 1, pageSize = 25, action = "", processName = "", actor = "", forceFresh = false) =>
    api
      .get<ApiResult<PagedResult<AuditHistoryItem>>>(
        `/api/v1/processes/history/audit?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}${
          action ? `&action=${encodeURIComponent(action)}` : ""
        }${processName ? `&process=${encodeURIComponent(processName)}` : ""}${
          actor ? `&actor=${encodeURIComponent(actor)}` : ""
        }${forceFresh ? `&_ts=${Date.now()}` : ""}`
      )
      .then(unwrap),
  gitCommits: (name: string, limit = 20) =>
    api.get<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/git/commits?limit=${encodeURIComponent(limit)}`).then(unwrap),
  gitPull: (name: string) =>
    api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/git/pull`).then(unwrap),
  get: (name: string) => api.get<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}`).then(unwrap),
  create: (config: Record<string, unknown>) => api.post<ApiResult<any>>("/api/v1/processes/create", config).then(unwrap),
  bulkAction: (action: string, names: string[] = []) => api.post<ApiResult<any>>("/api/v1/processes/bulk-action", { action, names }).then(unwrap),
  start: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/start`).then(unwrap),
  stop: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/stop`).then(unwrap),
  restart: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/restart`).then(unwrap),
  reload: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/reload`).then(unwrap),
  getDotEnv: (name: string) => api.get<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/dotenv`).then(unwrap),
  updateDotEnv: (name: string, values: Record<string, string> = {}) =>
    api.patch<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/dotenv`, { values }).then(unwrap),
  npmInstall: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/npm-install`).then(unwrap),
  npmBuild: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/npm-build`).then(unwrap),
  deploy: (name: string, payload: Record<string, unknown> = {}) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/deploy`, payload).then(unwrap),
  rollback: (name: string, payload: Record<string, unknown> = {}) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/rollback`, payload).then(unwrap),
  delete: (name: string) => api.delete<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}`).then(unwrap),
  logs: (name: string, lines = 100) => api.get<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/logs?lines=${lines}`).then(unwrap),
  flush: (name: string) => api.post<ApiResult<any>>(`/api/v1/processes/${encodeURIComponent(name)}/flush`).then(unwrap)
};

export const pm2Admin = {
  save: () => api.post<ApiResult<any>>("/api/v1/pm2/save").then(unwrap),
  resurrect: () => api.post<ApiResult<any>>("/api/v1/pm2/resurrect").then(unwrap),
  kill: () => api.post<ApiResult<any>>("/api/v1/pm2/kill").then(unwrap),
  info: () => api.get<ApiResult<any>>("/api/v1/pm2/info").then(unwrap)
};

export const alerts = {
  listChannels: () => api.get<ApiResult<any[]>>("/api/v1/alerts/channels").then(unwrap),
  saveChannel: (payload: Record<string, unknown>) => api.post<ApiResult<any>>("/api/v1/alerts/channels", payload).then(unwrap),
  deleteChannel: (id: string) => api.delete<ApiResult<any>>(`/api/v1/alerts/channels/${encodeURIComponent(id)}`).then(unwrap),
  testChannel: (id: string) => api.post<ApiResult<any>>(`/api/v1/alerts/channels/${encodeURIComponent(id)}/test`).then(unwrap),
  history: (limit = 200) => api.get<ApiResult<any[]>>(`/api/v1/alerts/history?limit=${encodeURIComponent(limit)}`).then(unwrap),
  clearHistory: () => api.delete<ApiResult<any>>("/api/v1/alerts/history").then(unwrap)
};

export const caddy = {
  status: () => api.get<ApiResult<any>>("/api/v1/caddy/status").then(unwrap),
  install: () => api.post<ApiResult<any>>("/api/v1/caddy/install").then(unwrap),
  addProxy: (payload: Record<string, unknown>) => api.post<ApiResult<any>>("/api/v1/caddy/proxies", payload).then(unwrap),
  deleteProxy: (domain: string) => api.delete<ApiResult<any>>(`/api/v1/caddy/proxies/${encodeURIComponent(domain)}`).then(unwrap),
  restart: () => api.post<ApiResult<any>>("/api/v1/caddy/restart").then(unwrap)
};

export default api;
