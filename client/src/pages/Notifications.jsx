import { useEffect, useMemo, useState } from "react";
import { Bell, AlertTriangle, Info, Siren, RefreshCw } from "lucide-react";
import toast, { getErrorMessage } from "../lib/toast";
import { alerts as alertsApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import Input from "../components/ui/Input";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

function levelIcon(level) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "danger") {
    return <Siren size={15} className="text-danger-300" />;
  }
  if (normalized === "warning") {
    return <AlertTriangle size={15} className="text-warning-300" />;
  }
  return <Info size={15} className="text-info-300" />;
}

export default function Notifications() {
  const { notifications: liveNotifications } = useSocket();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const loadHistory = async () => {
    setLoading(true);
    try {
      const result = await alertsApi.history(400);
      if (result.success && Array.isArray(result.data)) {
        setItems(result.data);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load notification history"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (!Array.isArray(liveNotifications) || liveNotifications.length === 0) {
      return;
    }
    setItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      const merged = [...prev];
      for (const item of liveNotifications) {
        if (item?.id && !seen.has(item.id)) {
          merged.push(item);
          seen.add(item.id);
        }
      }
      return merged.slice(-1000);
    });
  }, [liveNotifications]);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items
      .filter((item) => (level === "all" ? true : item.level === level))
      .filter((item) => (category === "all" ? true : item.category === category))
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        return [item.title, item.message, item.processName, item.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [items, level, category, query]);

  const clearHistory = async () => {
    if (!window.confirm("Clear all notification history?")) {
      return;
    }

    try {
      const result = await alertsApi.clearHistory();
      if (!result.success) {
        throw new Error(result.error || "Failed to clear notification history");
      }
      setItems([]);
      toast.success("Notification history cleared");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to clear notification history"));
    }
  };

  return (
    <div className="space-y-4">
      <PageIntro
        title="Notifications"
        description="Review live and historical system events with level/category filters in a single timeline."
      />

      <section className="page-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={level} onChange={(event) => setLevel(event.target.value)} className="w-32">
              <option value="all">All levels</option>
              <option value="danger">Danger</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </Select>
            <Select value={category} onChange={(event) => setCategory(event.target.value)} className="w-40">
              <option value="all">All categories</option>
              <option value="alert">Alert</option>
              <option value="deployment">Deployment</option>
              <option value="operation">Operation</option>
              <option value="lifecycle">Lifecycle</option>
            </Select>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notifications"
              className="w-full sm:w-64"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={loadHistory} disabled={loading}>
              <RefreshCw size={15} />
              Reload
            </Button>
            <Button variant="danger" onClick={clearHistory}>
              Clear History
            </Button>
          </div>
        </div>
      </section>

      <section className="page-panel">
        <PanelHeader title="Event Timeline" className="mb-3" />
        <div className="max-h-log-viewer space-y-2 overflow-y-auto pr-1">
          {visible.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-text-3">
              <Bell size={24} />
              <p className="mt-2 text-sm">No notifications found.</p>
            </div>
          )}

          {visible.map((item, index) => (
            <article key={item.id || `${item.ts}-${index}`} className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5">{levelIcon(item.level)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-1">{item.title || "Notification"}</p>
                  <p className="mt-1 text-sm text-text-2">{item.message || "-"}</p>
                  <p className="mt-2 text-xs text-text-3">
                    {new Date(item.ts).toLocaleString()} | {item.category || "event"}
                    {item.processName ? ` | ${item.processName}` : ""}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
