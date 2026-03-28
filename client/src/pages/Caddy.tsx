// @ts-nocheck
import { useEffect, useState } from "react";
import { caddy as caddyApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

export default function Caddy() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [status, setStatus] = useState({
    installed: false,
    available: false,
    caddyfilePath: "",
    managedSites: []
  });
  const [form, setForm] = useState({
    domain: "",
    upstream: "localhost:3000"
  });

  const loadStatus = async () => {
    try {
      setLoading(true);
      const result = await caddyApi.status();
      if (!result.success) {
        throw new Error(result.error || "Unable to read Caddy status");
      }
      setStatus((prev) => ({ ...prev, ...(result.data || {}) }));
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to read Caddy status"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const saveProxy = async () => {
    try {
      setSaving(true);
      const result = await caddyApi.addProxy({
        domain: form.domain,
        upstream: form.upstream
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to save reverse proxy");
      }
      toast.success(`Reverse proxy configured for ${form.domain}`);
      setForm((prev) => ({ ...prev, domain: "" }));
      await loadStatus();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save reverse proxy"));
    } finally {
      setSaving(false);
    }
  };

  const restartCaddy = async () => {
    try {
      setRestarting(true);
      const result = await caddyApi.restart();
      if (!result.success) {
        throw new Error(result.error || "Failed to restart Caddy");
      }
      toast.success("Caddy restarted");
      await loadStatus();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to restart Caddy"));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageIntro
        title="Caddy Reverse Proxy"
        description="Configure domain routing in one place and push updates to Caddy."
      />

      <section className="page-panel space-y-3">
        <PanelHeader title="Caddy Service" />
        <div className="text-sm text-text-2">
          <p>
            Caddy status:{" "}
            <span className={status.installed ? "text-success-300" : "text-danger-300"}>
              {status.installed ? "Installed" : "Not installed"}
            </span>
          </p>
          <p className="text-text-3">Caddyfile: {status.caddyfilePath || "-"}</p>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={!status.installed || loading || saving || restarting}
            onClick={restartCaddy}
          >
            {restarting ? "Restarting..." : "Restart Caddy"}
          </Button>
        </div>

        {!status.installed && (
          <p className="rounded-md border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-sm text-warning-300">
            Install Caddy first from the Extensions page.
          </p>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={form.domain}
            onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
            placeholder="example.com"
            disabled={!status.installed || saving || restarting || loading}
          />
          <Input
            value={form.upstream}
            onChange={(event) => setForm((prev) => ({ ...prev, upstream: event.target.value }))}
            placeholder="localhost:3000"
            disabled={!status.installed || saving || restarting || loading}
          />
        </div>
        <Button
          type="button"
          variant="outlineInfo"
          disabled={!status.installed || saving || restarting || loading}
          onClick={saveProxy}
        >
          {saving ? "Saving..." : "Add / Update Reverse Proxy"}
        </Button>
      </section>

      <section className="page-panel">
        <PanelHeader title="Managed Domains" className="mb-2" />
        {loading && <p className="text-sm text-text-3">Loading...</p>}
        {!loading && (!Array.isArray(status.managedSites) || status.managedSites.length === 0) && (
          <p className="text-sm text-text-3">No managed domains yet.</p>
        )}
        {Array.isArray(status.managedSites) && status.managedSites.length > 0 && (
          <div className="space-y-2">
            {status.managedSites.map((item) => (
              <div key={item.domain} className="page-panel p-2 text-sm">
                <p className="font-medium text-text-1">{item.domain}</p>
                <p className="text-text-3">reverse_proxy {item.upstream}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

