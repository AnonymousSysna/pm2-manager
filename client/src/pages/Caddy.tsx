import { useEffect, useState } from "react";
import { caddy as caddyApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";
import StatusText from "../components/ui/StatusText";

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
      const nextStatus = result.data || {};
      localStorage.setItem(
        "pm2_onboarding_has_domain",
        Array.isArray(nextStatus.managedSites) && nextStatus.managedSites.length > 0 ? "true" : "false"
      );
      setStatus((prev) => ({ ...prev, ...nextStatus }));
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
        {loading ? (
          <div className="space-y-3">
            <div className="text-sm text-text-2">
              <Skeleton className="mb-2 h-4 w-36" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <Skeleton className="h-10 w-36" />
            <div className="grid gap-2 md:grid-cols-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-56" />
          </div>
        ) : (
          <div className="text-sm text-text-2">
            <p>
              Caddy status:{" "}
              <StatusText tone={status.installed ? "success" : "warning"}>
                {status.installed ? "Installed" : "Not installed"}
              </StatusText>
            </p>
            <p className="text-text-3">Caddyfile: {status.caddyfilePath || "-"}</p>
          </div>
        )}
        {!loading && (
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
        )}

        {!loading && !status.installed && (
          <Banner tone="warning">
            Install Caddy first from the Extensions page.
          </Banner>
        )}

        {!loading && (
          <>
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
          </>
        )}
      </section>

      <section className="page-panel">
        <PanelHeader title="Managed Domains" className="mb-2" />
        {loading && <ManagedDomainsSkeleton />}
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
                    <StatusText
                      tone={
                        item?.https?.state === "active"
                          ? "success"
                          : item?.https?.state === "warning"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {item?.https?.state || "unknown"}
                    </StatusText>
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
        <ConfirmDialog
          title="Delete Domain"
          description={`Delete reverse proxy for ${pendingDeleteDomain}? This removes it from managed domains and updates the Caddyfile.`}
          confirmLabel={deletingDomain ? "Deleting..." : "Yes, Delete"}
          confirmDisabled={Boolean(deletingDomain)}
          onClose={() => {
            if (!deletingDomain) {
              setPendingDeleteDomain("");
            }
          }}
          onConfirm={() => deleteProxy(pendingDeleteDomain)}
        />
      )}
    </div>
  );
}

function ManagedDomainsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <InsetPanel key={index} padding="sm" className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-14" />
            <Skeleton className="h-8 w-16" />
          </div>
        </InsetPanel>
      ))}
    </div>
  );
}

