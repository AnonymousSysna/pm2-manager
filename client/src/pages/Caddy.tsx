import { useEffect, useState } from "react";
import { caddy as caddyApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Modal, { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";
import StatusText from "../components/ui/StatusText";

const emptyProxyForm = { domain: "", upstream: "localhost:3000" };

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
  const [form, setForm] = useState(emptyProxyForm);
  const [proxyModalOpen, setProxyModalOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState("");
  const canSaveProxy = Boolean(form.domain.trim() && form.upstream.trim());

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
        siteAddress: form.domain,
        upstream: form.upstream
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to save reverse proxy");
      }
      toast.success(`Reverse proxy configured for ${form.domain}`);
      if (Array.isArray(result?.data?.warnings) && result.data.warnings.length > 0) {
        toast.warning(`Saved, but Caddy reload warning: ${result.data.warnings[0]}`);
      }
      resetProxyForm();
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

  const openCreateProxy = () => {
    setForm(emptyProxyForm);
    setEditingDomain("");
    setProxyModalOpen(true);
  };

  const openEditProxy = (item) => {
    setForm({
      domain: item.siteAddress || item.domain || "",
      upstream: item.upstream || "localhost:3000"
    });
    setEditingDomain(item.domain || item.siteAddress || "");
    setProxyModalOpen(true);
  };

  const resetProxyForm = () => {
    setProxyModalOpen(false);
    setEditingDomain("");
    setForm(emptyProxyForm);
  };

  const closeProxyModal = () => {
    if (saving) {
      return;
    }
    resetProxyForm();
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
      if (editingDomain === domain) {
        setProxyModalOpen(false);
        setEditingDomain("");
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
      />

      <section className="page-panel compact-page-stack p-3">
        <PanelHeader
          title="Caddy Service"
          actions={loading ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!status.installed || restarting}
                onClick={restartCaddy}
              >
                {restarting ? "Restarting..." : "Restart Caddy"}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!status.installed}
                onClick={openCreateProxy}
              >
                Add reverse proxy
              </Button>
            </div>
          )}
        />
        {loading ? (
          <div className="space-y-2 text-sm text-text-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-64 max-w-full" />
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

        {!loading && !status.installed && (
          <Banner tone="warning">
            Install Caddy first from the Extensions page.
          </Banner>
        )}
      </section>

      <section className="page-panel">
        <PanelHeader title="Managed Domains" className="mb-2" />
        {loading && <ManagedDomainsSkeleton />}
        {!loading && (!Array.isArray(status.managedSites) || status.managedSites.length === 0) && (
          <p className="text-sm text-text-3">No domains.</p>
        )}
        {Array.isArray(status.managedSites) && status.managedSites.length > 0 && (
          <div className="space-y-2">
            {status.managedSites.map((item) => (
              <InsetPanel key={item.domain} padding="sm" className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-text-1">{item.publicUrl || item.siteAddress || item.domain}</p>
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
                    onClick={() => openEditProxy(item)}
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

      {proxyModalOpen && (
        <Modal
          title={editingDomain ? "Update reverse proxy" : "Add reverse proxy"}
          size="sm"
          onClose={closeProxyModal}
          disableClose={saving}
          actions={(
            <>
              <Button type="button" variant="secondary" onClick={closeProxyModal} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="caddy-proxy-form"
                variant="primary"
                disabled={saving || !canSaveProxy}
              >
                {saving ? "Saving..." : editingDomain ? "Save changes" : "Add proxy"}
              </Button>
            </>
          )}
        >
          <form
            id="caddy-proxy-form"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveProxy();
            }}
          >
            <Field label="Domain" required>
              <Input
                autoFocus
                value={form.domain}
                onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
                placeholder="example.com or https://example.com:8000"
                disabled={saving}
              />
            </Field>
            <Field label="Upstream" required>
              <Input
                value={form.upstream}
                onChange={(event) => setForm((prev) => ({ ...prev, upstream: event.target.value }))}
                placeholder="localhost:3000"
                disabled={saving}
              />
            </Field>
          </form>
        </Modal>
      )}

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
