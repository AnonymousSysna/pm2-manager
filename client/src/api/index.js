import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || ""
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("pm2_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem("pm2_token");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

const unwrap = (response) => response.data;

export const auth = {
  login: (username, password) => api.post("/api/auth/login", { username, password }).then(unwrap),
  changePassword: (currentPassword, newPassword) =>
    api.post("/api/auth/change-password", { currentPassword, newPassword }).then(unwrap)
};

export const processes = {
  list: () => api.get("/api/processes").then(unwrap),
  get: (name) => api.get(`/api/processes/${encodeURIComponent(name)}`).then(unwrap),
  create: (config) => api.post("/api/processes/create", config).then(unwrap),
  start: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/start`).then(unwrap),
  stop: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/stop`).then(unwrap),
  restart: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/restart`).then(unwrap),
  reload: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/reload`).then(unwrap),
  npmInstall: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/npm-install`).then(unwrap),
  npmBuild: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/npm-build`).then(unwrap),
  delete: (name) => api.delete(`/api/processes/${encodeURIComponent(name)}`).then(unwrap),
  logs: (name, lines = 100) => api.get(`/api/processes/${encodeURIComponent(name)}/logs?lines=${lines}`).then(unwrap),
  flush: (name) => api.post(`/api/processes/${encodeURIComponent(name)}/flush`).then(unwrap)
};

export const pm2Admin = {
  save: () => api.post("/api/pm2/save").then(unwrap),
  resurrect: () => api.post("/api/pm2/resurrect").then(unwrap),
  kill: () => api.post("/api/pm2/kill").then(unwrap),
  info: () => api.get("/api/pm2/info").then(unwrap)
};

export default api;
