import { useEffect, useMemo, useState } from "react";
import { Activity, Bell, Bot, Globe, History, Menu, Plus, Puzzle, ScrollText, Settings, LogOut, Moon, Sun, X, TerminalSquare } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { auth } from "../api";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import NavItem from "./ui/NavItem";
import { Eyebrow } from "./ui/Typography";

const navGroups = [
  {
    label: "Operate",
    links: [
      { to: "/dashboard", label: "Overview", icon: Activity },
      { to: "/dashboard/create", label: "Add", icon: Plus },
      { to: "/dashboard/logs", label: "Logs", icon: ScrollText },
      { to: "/dashboard/notifications", label: "Alerts", icon: Bell }
    ]
  },
  {
    label: "Review",
    links: [
      { to: "/dashboard/history", label: "History", icon: History },
      { to: "/dashboard/settings", label: "Settings", icon: Settings },
      { to: "/dashboard/caddy", label: "Proxy", icon: Globe }
    ]
  },
  {
    label: "Advanced",
    links: [
      { to: "/dashboard/ai", label: "AI", icon: Bot },
      { to: "/dashboard/pm2-features", label: "PM2 Tools", icon: TerminalSquare },
      { to: "/dashboard/extensions", label: "Extensions", icon: Puzzle }
    ]
  }
];

const pageTitleMap = {
  "/dashboard": "Overview",
  "/dashboard/create": "Add Process",
  "/dashboard/notifications": "Alerts",
  "/dashboard/logs": "Logs",
  "/dashboard/history": "History",
  "/dashboard/settings": "Settings",
  "/dashboard/ai": "AI Operator",
  "/dashboard/pm2-features": "PM2 Tools",
  "/dashboard/extensions": "Extensions",
  "/dashboard/caddy": "Caddy Proxy"
};

function NavLinks({ pathname, groups, onNavigate }) {
  return (
    <nav className="space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="nav-section-label">{group.label}</p>
          <div className="space-y-1">
            {group.links.map(({ to, label, icon: Icon }) => {
              const active = pathname === to;
              return (
                <NavItem
                  key={to}
                  as={Link}
                  to={to}
                  onClick={onNavigate}
                  active={active}
                >
                  <Icon size={16} />
                  {label}
                </NavItem>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, reconnecting } = useSocket();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("pm2_theme") === "light" ? "light" : "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pm2_theme", theme);
  }, [theme]);

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
    <div className="app-shell">
      {reconnecting && (
        <div className="sticky top-0 z-40 border-b border-warning-500/40 bg-warning-500/15 px-4 py-2 text-center text-sm text-warning-300">
          Reconnecting. Live updates paused.
        </div>
      )}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="flex min-w-0 items-center gap-3">
            <Button type="button" variant="secondary" size="icon" onClick={() => setMobileOpen(true)} className="md:hidden" aria-label="Open navigation">
              <Menu size={18} />
            </Button>
            <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-xs font-bold text-white md:flex">PM2</div>
            <div className="min-w-0">
              <Eyebrow>PM2 Manager</Eyebrow>
              <p className="page-title truncate">{title}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
              {connected ? "Live" : reconnecting ? "Reconnecting" : "Offline"}
            </Badge>
          </div>
        </div>
      </header>

      <div className="app-workspace">
        <aside className="app-sidebar">
          <NavLinks pathname={location.pathname} groups={navGroups} />
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
              <Button type="button" variant="secondary" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X size={16} />
              </Button>
            </div>
            <NavLinks pathname={location.pathname} groups={navGroups} onNavigate={() => setMobileOpen(false)} />
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
