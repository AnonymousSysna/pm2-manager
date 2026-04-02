// @ts-nocheck
import { useEffect, useState } from "react";
import { caddy as caddyApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

export default function Caddy() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [deletingDomain, setDeletingDomain] = useState("");
  const [pendingDeleteDomain, setPendingDeleteDomain] = useState("");
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
      if (Array.isArray(result?.data?.warnings) && result.data.warnings.length > 0) {
        toast.warning(`Saved, but Caddy reload warning: ${result.data.warnings[0]}`);
      }
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

  const editProxy = (item) => {
    setForm({
      domain: item.domain || "",
      upstream: item.upstream || "localhost:3000"
    });
  };

  const deleteProxy = async (domain) => {
    try {
      setDeletingDomain(domain);
      const result = await caddyApi.deleteProxy(domain);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete reverse proxy");
      }
      toast.success(`Removed reverse proxy for ${domain}`);
      if (Array.isArray(result?.data?.warnings) && result.data.warnings.length > 0) {
        toast.warning(`Deleted, but Caddy reload warning: ${result.data.warnings[0]}`);
      }
      if (form.domain === domain) {
        setForm((prev) => ({ ...prev, domain: "" }));
      }
      await loadStatus();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete reverse proxy"));
    } finally {
      setDeletingDomain("");
      setPendingDeleteDomain("");
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
            <span className={status.installed ? "text-success-300" : "text-warning-300"}>
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
          <Banner tone="warning">
            Install Caddy first from the Extensions page.
          </Banner>
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
              <InsetPanel key={item.domain} padding="sm" className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-text-1">{item.domain}</p>
                  <p className="text-text-3">reverse_proxy {item.upstream}</p>
                  <p className="text-xs text-text-3">
                    HTTPS:{" "}
                    <span
                      className={
                        item?.https?.state === "active"
                          ? "text-success-300"
                          : item?.https?.state === "warning"
                            ? "text-warning-300"
                            : "text-danger-300"
                      }
                    >
                      {item?.https?.state || "unknown"}
                    </span>
                    {item?.https?.message ? ` (${item.https.message})` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outlineInfo"
                    size="sm"
                    disabled={saving || restarting || loading || deletingDomain === item.domain}
                    onClick={() => editProxy(item)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outlineDanger"
                    size="sm"
                    disabled={saving || restarting || loading || deletingDomain === item.domain}
                    onClick={() => setPendingDeleteDomain(item.domain)}
                  >
                    {deletingDomain === item.domain ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </InsetPanel>
            ))}
          </div>
        )}
      </section>

      {pendingDeleteDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="surface-overlay absolute inset-0"
            aria-label="Close delete confirmation"
            onClick={() => {
              if (!deletingDomain) {
                setPendingDeleteDomain("");
              }
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl">
            <PanelHeader title="Delete Domain" className="mb-2" />
            <p className="text-sm text-text-2">
              Delete reverse proxy for <span className="font-semibold">{pendingDeleteDomain}</span>?
            </p>
            <p className="mt-1 text-xs text-text-3">
              This removes it from managed domains and updates the Caddyfile.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(deletingDomain)}
                onClick={() => setPendingDeleteDomain("")}
              >
                No
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={Boolean(deletingDomain)}
                onClick={() => deleteProxy(pendingDeleteDomain)}
              >
                {deletingDomain ? "Deleting..." : "Yes, Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

