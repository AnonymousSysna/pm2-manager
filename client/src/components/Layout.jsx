import { useEffect, useMemo, useState } from "react";
import { Activity, Plus, ScrollText, Settings, LogOut } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { auth } from "../api";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

const links = [
  { to: "/dashboard", label: "Processes", icon: Activity },
  { to: "/dashboard/create", label: "Create Process", icon: Plus },
  { to: "/dashboard/logs", label: "Logs", icon: ScrollText },
  { to: "/dashboard/settings", label: "Settings", icon: Settings }
];

const pageTitleMap = {
  "/dashboard": "Processes",
  "/dashboard/create": "Create Process",
  "/dashboard/logs": "Logs",
  "/dashboard/settings": "Settings"
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected } = useSocket();
  const [now, setNow] = useState(new Date());
  const [pendingGoKey, setPendingGoKey] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || event.target.isContentEditable) {
          return;
        }
      }

      const key = String(event.key || "").toLowerCase();
      if (pendingGoKey) {
        if (key === "p") {
          navigate("/dashboard");
        } else if (key === "l") {
          navigate("/dashboard/logs");
        } else if (key === "c") {
          navigate("/dashboard/create");
        } else if (key === "s") {
          navigate("/dashboard/settings");
        }
        setPendingGoKey(false);
        return;
      }

      if (key === "g") {
        setPendingGoKey(true);
        setTimeout(() => setPendingGoKey(false), 1200);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, pendingGoKey]);

  const title = useMemo(() => pageTitleMap[location.pathname] || "Dashboard", [location.pathname]);

  const logout = async () => {
    try {
      await auth.logout();
    } catch (_error) {
      // Redirect to login even if the session is already gone server-side.
    }
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-bg text-text-1 md:flex">
      <aside className="w-full border-b border-border bg-surface p-4 md:fixed md:inset-y-0 md:left-0 md:w-64 md:border-b-0 md:border-r md:p-5">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-bg">PM2</div>
          <p className="text-lg font-semibold text-text-1">PM2 Manager</p>
        </div>

        <nav className="space-y-2">
          {links.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  active ? "bg-brand-500/20 text-brand-300" : "text-text-2 hover:bg-surface-2"
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}
        </nav>

        <Button
          type="button"
          variant="secondary"
          onClick={logout}
          className="mt-8 w-full justify-start md:absolute md:bottom-5 md:left-5 md:right-5 md:w-auto"
        >
          <LogOut size={17} />
          Logout
        </Button>
      </aside>

      <main className="flex-1 p-4 md:ml-64 md:p-6">
        <header className="page-panel mb-5 flex flex-wrap items-center justify-between gap-4">
          <h1 className="page-title">{title}</h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-text-3 lg:inline">Shortcuts: g then p/l/c/s</span>
            <Badge tone={connected ? "success" : "danger"}>{connected ? "Connected" : "Disconnected"}</Badge>
            <span className="text-text-3">{now.toLocaleString()}</span>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
