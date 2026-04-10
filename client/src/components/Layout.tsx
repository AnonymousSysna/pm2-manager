import { useEffect, useMemo, useState } from "react";
import { Activity, Bell, Globe, History, Menu, Plus, Puzzle, ScrollText, Settings, LogOut, Moon, Sun, X } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { auth, caddy as caddyApi } from "../api";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

const staticLinks = [
  { to: "/dashboard", label: "Operations", icon: Activity },
  { to: "/dashboard/create", label: "Add Process", icon: Plus },
  { to: "/dashboard/notifications", label: "Alerts", icon: Bell },
  { to: "/dashboard/logs", label: "Process Logs", icon: ScrollText },
  { to: "/dashboard/history", label: "Audit Trail", icon: History },
  { to: "/dashboard/settings", label: "Runtime Settings", icon: Settings },
  { to: "/dashboard/extensions", label: "Extensions", icon: Puzzle }
];

const pageTitleMap = {
  "/dashboard": "Operations Console",
  "/dashboard/create": "Add Process",
  "/dashboard/notifications": "Alert Center",
  "/dashboard/logs": "Process Logs",
  "/dashboard/history": "Audit Trail",
  "/dashboard/settings": "Runtime Settings",
  "/dashboard/extensions": "Extensions",
  "/dashboard/caddy": "Caddy Reverse Proxy"
};

function NavLinks({ pathname, links, onNavigate }) {
  return (
    <nav className="space-y-1.5">
      {links.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
              active ? "bg-brand-500/20 text-brand-400" : "text-text-2 hover:bg-surface-2"
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, reconnecting } = useSocket();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [caddyAvailable, setCaddyAvailable] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("pm2_theme") === "light" ? "light" : "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pm2_theme", theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    const refreshCaddyStatus = () => {
      caddyApi
        .status()
        .then((result) => {
          if (!active || !result.success) {
            return;
          }
          setCaddyAvailable(Boolean(result.data?.available));
        })
        .catch(() => {
          if (active) {
            setCaddyAvailable(false);
          }
        });
    };
    refreshCaddyStatus();
    const timer = setInterval(refreshCaddyStatus, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const links = useMemo(() => {
    if (!caddyAvailable) {
      return staticLinks;
    }
    return [...staticLinks, { to: "/dashboard/caddy", label: "Caddy", icon: Globe }];
  }, [caddyAvailable]);

  const title = useMemo(() => pageTitleMap[location.pathname] || "PM2 Manager", [location.pathname]);

  const logout = async () => {
    try {
      await auth.logout();
    } catch (_error) {
      // Redirect to login even if session already expired.
    }
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-bg text-text-1">
      {reconnecting && (
        <div className="sticky top-0 z-40 border-b border-warning-500/40 bg-warning-500/15 px-4 py-2 text-center text-sm text-warning-300">
          Reconnecting... Live process updates are temporarily paused.
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-layout items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 md:hidden"
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>
            <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-bg md:flex">PM2</div>
            <div>
              <p className="text-xs uppercase tracking-wide text-text-3">PM2 Manager</p>
              <p className="page-title">{title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </Button>
            <Badge tone={connected ? "success" : reconnecting ? "warning" : "danger"}>
              {connected ? "Connected" : reconnecting ? "Reconnecting" : "Disconnected"}
            </Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-layout gap-4 px-4 py-4 md:px-6 md:py-6">
        <aside className="sticky top-header hidden h-[calc(100vh-theme(spacing.header)-theme(spacing.6))] w-64 shrink-0 rounded-xl border border-border bg-surface p-4 md:flex md:flex-col">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3 text-sm text-text-3">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            Operator navigation
          </div>
          <NavLinks pathname={location.pathname} links={links} />
          <Button type="button" variant="secondary" onClick={logout} className="mt-auto w-full justify-start">
            <LogOut size={16} />
            Logout
          </Button>
        </aside>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" className="surface-overlay absolute inset-0" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
          <aside className="relative h-full w-nav-drawer max-w-xs border-r border-border bg-surface p-4">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <p className="font-semibold text-text-1">Menu</p>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                aria-label="Close navigation"
              >
                <X size={16} />
              </button>
            </div>
            <NavLinks pathname={location.pathname} links={links} onNavigate={() => setMobileOpen(false)} />
            <Button type="button" variant="secondary" onClick={logout} className="mt-4 w-full justify-start">
              <LogOut size={16} />
              Logout
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}


