import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  withCredentials: true
});

function isAuthEndpoint(url) {
  const value = String(url || "");
  return (
    value.includes("/api/v1/auth/login") ||
    value.includes("/api/v1/auth/me") ||
    value.includes("/api/v1/auth/logout") ||
    value.includes("/api/auth/login") ||
    value.includes("/api/auth/me") ||
    value.includes("/api/auth/logout")
  );
}

function getCookie(name) {
  const cookie = document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

api.interceptors.request.use((config) => {
  const method = String(config.method || "get").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = getCookie("pm2_csrf");
    if (csrf) {
      config.headers = config.headers || {};
      config.headers["x-csrf-token"] = csrf;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const requestUrl = error?.config?.url;
    const onLoginRoute = window.location.pathname.startsWith("/login");

    if (status === 401 && !isAuthEndpoint(requestUrl)) {
      if (!onLoginRoute) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

const unwrap = (response) => response.data;

export const auth = {
  login: (username, password) => api.post("/api/v1/auth/login", { username, password }).then(unwrap),
  me: () => api.get("/api/v1/auth/me").then(unwrap),
  logout: () => api.post("/api/v1/auth/logout").then(unwrap),
  changePassword: (currentPassword, newPassword) =>
    api.post("/api/v1/auth/change-password", { currentPassword, newPassword }).then(unwrap)
};

export const processes = {
  list: () => api.get("/api/v1/processes").then(unwrap),
  get: (name) => api.get(`/api/v1/processes/${encodeURIComponent(name)}`).then(unwrap),
  create: (config) => api.post("/api/v1/processes/create", config).then(unwrap),
  start: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/start`).then(unwrap),
  stop: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/stop`).then(unwrap),
  restart: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/restart`).then(unwrap),
  reload: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/reload`).then(unwrap),
  npmInstall: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/npm-install`).then(unwrap),
  npmBuild: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/npm-build`).then(unwrap),
  delete: (name) => api.delete(`/api/v1/processes/${encodeURIComponent(name)}`).then(unwrap),
  logs: (name, lines = 100) => api.get(`/api/v1/processes/${encodeURIComponent(name)}/logs?lines=${lines}`).then(unwrap),
  flush: (name) => api.post(`/api/v1/processes/${encodeURIComponent(name)}/flush`).then(unwrap)
};

export const pm2Admin = {
  save: () => api.post("/api/v1/pm2/save").then(unwrap),
  resurrect: () => api.post("/api/v1/pm2/resurrect").then(unwrap),
  kill: () => api.post("/api/v1/pm2/kill").then(unwrap),
  info: () => api.get("/api/v1/pm2/info").then(unwrap)
};

export default api;
