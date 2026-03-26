import { useEffect, useMemo, useState } from "react";
import { Activity, Plus, ScrollText, Settings, LogOut } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";

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

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const title = useMemo(() => pageTitleMap[location.pathname] || "Dashboard", [location.pathname]);

  const logout = () => {
    localStorage.removeItem("pm2_token");
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 md:flex">
      <aside className="w-full bg-slate-800 p-4 md:fixed md:inset-y-0 md:left-0 md:w-60 md:p-5">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-500 p-2 text-center text-sm font-bold leading-6 text-slate-900">PM2</div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
        </div>

        <nav className="space-y-2">
          {links.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-green-500/20 text-green-300" : "text-slate-300 hover:bg-slate-700"
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="mt-8 flex w-full items-center gap-3 rounded-md bg-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-600 md:absolute md:bottom-5 md:left-5 md:right-5 md:w-auto"
        >
          <LogOut size={17} />
          Logout
        </button>
      </aside>

      <main className="flex-1 p-6 md:ml-60">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-900 p-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <div className="flex items-center gap-4 text-sm">
            <span className={`rounded-full px-3 py-1 font-medium ${connected ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
              {connected ? "Connected" : "Disconnected"}
            </span>
            <span className="text-slate-300">{now.toLocaleString()}</span>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}