import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Play, TerminalSquare } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { pm2Admin, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import Select from "../components/ui/Select";
import { Skeleton } from "../components/ui/Skeleton";
import TabButton from "../components/ui/TabButton";
import Textarea from "../components/ui/Textarea";

const riskTone = {
  read: "neutral",
  "sensitive-read": "warning",
  write: "info",
  critical: "danger"
};

function makeDefaultForm(feature, preferredProcess) {
  const form = {};
  for (const field of feature.fields || []) {
    if (field.name === "target" && preferredProcess) {
      form[field.name] = preferredProcess;
    } else {
      form[field.name] = field.defaultValue || "";
    }
  }
  return form;
}

function groupFeatures(features) {
  return features.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {});
}

function stringifyOutput(result) {
  const data = result?.data || {};
  if (data.parsed) {
    return JSON.stringify(data.parsed, null, 2);
  }
  return String(data.output || "").trim() || "No output returned.";
}

export default function PM2Features() {
  const [searchParams] = useSearchParams();
  const preferredProcess = searchParams.get("process") || "";
  const [catalog, setCatalog] = useState({ categories: [], features: [], coverageNotes: [] });
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("observe");
  const [forms, setForms] = useState({});
  const [runningId, setRunningId] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [pendingFeature, setPendingFeature] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([pm2Admin.features(), processApi.list()])
      .then(([featureResult, processResult]) => {
        if (!active) {
          return;
        }
        if (featureResult.success) {
          const nextCatalog = featureResult.data || { categories: [], features: [], coverageNotes: [] };
          setCatalog(nextCatalog);
          if (nextCatalog.categories?.[0]?.id) {
            setSelectedCategory((prev) => prev || nextCatalog.categories[0].id);
          }
        }
        if (processResult.success && Array.isArray(processResult.data)) {
          setProcesses(processResult.data);
        }
      })
      .catch((error) => {
        toast.error(getErrorMessage(error, "Unable to load PM2 features"));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const featuresByCategory = useMemo(() => groupFeatures(catalog.features || []), [catalog.features]);
  const selectedFeatures = featuresByCategory[selectedCategory] || [];
  const selectedCategoryMeta = (catalog.categories || []).find((item) => item.id === selectedCategory);

  const updateField = (feature, name, value) => {
    setForms((prev) => ({
      ...prev,
      [feature.id]: {
        ...makeDefaultForm(feature, preferredProcess),
        ...(prev[feature.id] || {}),
        [name]: value
      }
    }));
  };

  const executeFeature = async (feature, acknowledged = false) => {
    if (feature.risk === "critical" && !acknowledged) {
      setPendingFeature(feature);
      return;
    }

    const payload = {
      ...makeDefaultForm(feature, preferredProcess),
      ...(forms[feature.id] || {})
    };

    try {
      setRunningId(feature.id);
      const result = await pm2Admin.runFeature(feature.id, payload, acknowledged ? feature.id : "");
      if (!result.success) {
        throw new Error(result.error || `${feature.label} failed`);
      }
      setLastResult(result);
      toast.success(`${feature.label} completed`);
    } catch (error) {
      setLastResult(error?.response?.data || null);
      toast.error(getErrorMessage(error, `${feature.label} failed`));
    } finally {
      setRunningId("");
    }
  };

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(stringifyOutput(lastResult));
      toast.success("Output copied");
    } catch (_error) {
      toast.error("Unable to copy output");
    }
  };

  return (
    <div className="space-y-4">
      <PageIntro
        title="PM2 Features"
        description="A guarded workspace for PM2 commands that do not fit the normal dashboard flow. Use Overview for daily triage; use this page for advanced PM2 operations."
      />

      <section className="page-panel space-y-3">
        <PanelHeader
          title="Feature map"
          description="Grouped by user goal so the page stays usable even while covering most PM2 commands."
        />
        {loading ? (
          <div className="grid gap-2 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(catalog.categories || []).map((category) => (
                <TabButton
                  key={category.id}
                  active={selectedCategory === category.id}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  {category.label}
                </TabButton>
              ))}
            </div>
            {selectedCategoryMeta ? (
              <InsetPanel padding="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-text-1">{selectedCategoryMeta.label}</p>
                </div>
                <Badge tone="info">{selectedFeatures.length} actions</Badge>
              </InsetPanel>
            ) : null}
          </>
        )}
      </section>

      <datalist id="pm2-process-targets">
        <option value="all" />
        {(processes || []).map((proc) => <option key={proc.name} value={proc.name} />)}
      </datalist>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr),420px]">
        <div className="space-y-3">
          {selectedFeatures.map((feature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              form={{ ...makeDefaultForm(feature, preferredProcess), ...(forms[feature.id] || {}) }}
              processes={processes}
              running={runningId === feature.id}
              onChange={(name, value) => updateField(feature, name, value)}
              onRun={() => executeFeature(feature)}
            />
          ))}
          {!loading && selectedFeatures.length === 0 && (
            <section className="page-panel text-sm text-text-3">No PM2 features found in this group.</section>
          )}
        </div>

        <aside className="space-y-3">
          <section className="page-panel sticky top-header space-y-3">
            <PanelHeader title="Last result" />
            {lastResult ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={lastResult.success ? "success" : "danger"}>{lastResult.success ? "Success" : "Failed"}</Badge>
                  {lastResult.data?.risk ? <Badge tone={riskTone[lastResult.data.risk] || "neutral"}>{lastResult.data.risk}</Badge> : null}
                  {lastResult.data?.code !== undefined ? <Badge tone="neutral">code {lastResult.data.code}</Badge> : null}
                </div>
                <p className="break-all rounded-lg border border-border bg-surface-2/60 p-2 text-xs text-text-3">
                  {lastResult.data?.command || lastResult.error || "No command recorded"}
                </p>
                <Textarea
                  readOnly
                  value={stringifyOutput(lastResult)}
                  className="min-h-[280px] resize-y font-mono text-xs"
                />
                <Button type="button" variant="secondary" onClick={copyOutput} className="w-full">
                  <Copy size={14} />
                  Copy output
                </Button>
              </>
            ) : (
              <InsetPanel padding="sm" className="text-sm text-text-3">
                Run a feature to see the command, exit code, and cleaned output here.
              </InsetPanel>
            )}
          </section>

        </aside>
      </section>

      {pendingFeature && (
        <ConfirmDialog
          title={`Run ${pendingFeature.label}?`}
          description="This can change PM2 or running apps."
          confirmLabel="Run action"
          confirmVariant="danger"
          onClose={() => setPendingFeature(null)}
          onConfirm={() => {
            const feature = pendingFeature;
            setPendingFeature(null);
            executeFeature(feature, true);
          }}
        />
      )}
    </div>
  );
}

function FeatureCard({ feature, form, processes, running, onChange, onRun }) {
  return (
    <article className="page-panel space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="panel-heading">{feature.label}</h2>
            <Badge tone={riskTone[feature.risk] || "neutral"}>{feature.risk}</Badge>
          </div>
          <p className="mt-1 break-all rounded-md border border-border/70 bg-surface-2/45 px-2 py-1 font-mono text-xs text-text-3">
            {feature.commandPreview}
          </p>
        </div>
        <Button type="button" variant={feature.risk === "critical" ? "danger" : "secondary"} disabled={running} onClick={onRun}>
          {feature.risk === "critical" ? <AlertTriangle size={14} /> : <Play size={14} />}
          {running ? "Running..." : "Run"}
        </Button>
      </div>

      {feature.risk === "sensitive-read" && (
        <Banner tone="warning" className="text-xs">
          Sensitive output. Review before sharing.
        </Banner>
      )}

      {(feature.fields || []).length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {feature.fields.map((field) => (
            <FeatureField
              key={field.name}
              field={field}
              value={form[field.name] || ""}
              processes={processes}
              onChange={(value) => onChange(field.name, value)}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function FeatureField({ field, value, processes, onChange }) {
  if (field.type === "select") {
    return (
      <Field label={field.label}>
        <Select value={value} onChange={(event) => onChange(event.target.value)}>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      <div className="relative">
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={value}
          min={field.min}
          max={field.max}
          list={field.type === "target" ? "pm2-process-targets" : undefined}
          placeholder={field.placeholder || field.defaultValue || ""}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.type === "target" ? <TerminalSquare className="pointer-events-none absolute right-2 top-2.5 text-text-3" size={14} /> : null}
      </div>

    </Field>
  );
}
