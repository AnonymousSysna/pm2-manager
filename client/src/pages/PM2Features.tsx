import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Play, Settings2, TerminalSquare } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { pm2Admin, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Modal, { ConfirmDialog } from "../components/ui/Modal";
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
  return String(data.output || "").trim() || "No output.";
}

function featurePayload(feature, forms, preferredProcess) {
  return {
    ...makeDefaultForm(feature, preferredProcess),
    ...(forms[feature.id] || {})
  };
}

function configuredCount(feature, forms, preferredProcess) {
  const payload = featurePayload(feature, forms, preferredProcess);
  return (feature.fields || []).filter((field) => String(payload[field.name] || "").trim()).length;
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
  const [optionsFeature, setOptionsFeature] = useState(null);

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

    const payload = featurePayload(feature, forms, preferredProcess);

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
    <div className="pm2-tools-page">
      <section className="page-panel pm2-tools-header-card">
        <div className="pm2-tools-header-main">
          <div className="min-w-0">
            <h1 className="page-heading">PM2 Tools</h1>
            <div className="pm2-tools-meta-row">
              <Badge tone="neutral">{processes.length} processes</Badge>
              <Badge tone="info">{selectedFeatures.length} actions</Badge>
              {selectedCategoryMeta ? <Badge tone="success">{selectedCategoryMeta.label}</Badge> : null}
            </div>
          </div>
          {runningId ? <Badge tone="warning">Running</Badge> : <Badge tone="neutral">Ready</Badge>}
        </div>

        {loading ? (
          <div className="pm2-category-skeletons">
            {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}
          </div>
        ) : (
          <div className="pm2-category-strip" aria-label="PM2 feature groups">
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
        )}
      </section>

      <datalist id="pm2-process-targets">
        <option value="all" />
        {(processes || []).map((proc) => <option key={proc.name} value={proc.name} />)}
      </datalist>

      <section className="page-panel pm2-command-panel">
        <div className="pm2-command-panel-head">
          <div className="min-w-0">
            <h2 className="panel-heading">{selectedCategoryMeta?.label || "Actions"}</h2>
          </div>
          <Badge tone="neutral">{selectedFeatures.length}</Badge>
        </div>

        {loading ? (
          <div className="pm2-command-list">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}
          </div>
        ) : selectedFeatures.length ? (
          <div className="pm2-command-list">
            {selectedFeatures.map((feature) => (
              <FeatureRow
                key={feature.id}
                feature={feature}
                running={runningId === feature.id}
                configuredCount={configuredCount(feature, forms, preferredProcess)}
                onConfigure={() => setOptionsFeature(feature)}
                onRun={() => executeFeature(feature)}
              />
            ))}
          </div>
        ) : (
          <InsetPanel padding="sm" className="result-empty-state">No actions.</InsetPanel>
        )}
      </section>

      <section className="page-panel pm2-result-panel-bottom">
        <div className="pm2-result-head">
          <div className="min-w-0">
            <h2 className="panel-heading">Result</h2>
          </div>
          {lastResult ? (
            <Button type="button" size="sm" variant="secondary" onClick={copyOutput}>
              <Copy size={14} />
              Copy
            </Button>
          ) : null}
        </div>

        {lastResult ? (
          <div className="pm2-result-body">
            <div className="pm2-result-meta">
              <Badge tone={lastResult.success ? "success" : "danger"}>{lastResult.success ? "Success" : "Failed"}</Badge>
              {lastResult.data?.risk ? <Badge tone={riskTone[lastResult.data.risk] || "neutral"}>{lastResult.data.risk}</Badge> : null}
              {lastResult.data?.code !== undefined ? <Badge tone="neutral">code {lastResult.data.code}</Badge> : null}
            </div>
            <p className="pm2-result-command">
              {lastResult.data?.command || lastResult.error || "No command recorded"}
            </p>
            <Textarea
              readOnly
              value={stringifyOutput(lastResult)}
              className="min-h-[180px] resize-y font-mono text-xs"
            />
          </div>
        ) : (
          <InsetPanel padding="sm" className="result-empty-state">
            No result.
          </InsetPanel>
        )}
      </section>

      {optionsFeature && (
        <Modal
          title={`${optionsFeature.label} options`}
          description={optionsFeature.commandPreview}
          size="lg"
          onClose={() => setOptionsFeature(null)}
          actions={(
            <>
              <Button type="button" variant="secondary" onClick={() => setOptionsFeature(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={optionsFeature.risk === "critical" ? "danger" : "primary"}
                disabled={runningId === optionsFeature.id}
                onClick={() => {
                  const feature = optionsFeature;
                  setOptionsFeature(null);
                  executeFeature(feature);
                }}
              >
                {runningId === optionsFeature.id ? "Running..." : "Run action"}
              </Button>
            </>
          )}
        >
          <div className="ai-setup-card pm2-options-modal-card">
            <div className="pm2-options-modal-topline">
              <Badge tone={riskTone[optionsFeature.risk] || "neutral"}>{optionsFeature.risk}</Badge>
              <span className="command-chip">{optionsFeature.commandPreview}</span>
            </div>
            {(optionsFeature.fields || []).length ? (
              <div className="pm2-options-modal-fields">
                {optionsFeature.fields.map((field) => (
                  <FeatureField
                    key={field.name}
                    field={field}
                    value={featurePayload(optionsFeature, forms, preferredProcess)[field.name] || ""}
                    processes={processes}
                    onChange={(value) => updateField(optionsFeature, field.name, value)}
                  />
                ))}
              </div>
            ) : (
              <InsetPanel padding="sm" className="result-empty-state">No options.</InsetPanel>
            )}
          </div>
        </Modal>
      )}

      {pendingFeature && (
        <ConfirmDialog
          title={`Run ${pendingFeature.label}?`}
          description="This can affect running apps."
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

function FeatureRow({ feature, running, configuredCount: activeOptions, onConfigure, onRun }) {
  const hasFields = (feature.fields || []).length > 0;

  return (
    <article className="pm2-command-row">
      <div className="pm2-command-main">
        <div className="pm2-command-title-line">
          <h3 className="pm2-command-title">{feature.label}</h3>
          <Badge tone={riskTone[feature.risk] || "neutral"}>{feature.risk}</Badge>
          {hasFields && activeOptions ? <Badge tone="info">{activeOptions} set</Badge> : null}
          {feature.risk === "sensitive-read" ? <Badge tone="warning">review output</Badge> : null}
        </div>
        <p className="command-chip">{feature.commandPreview}</p>
      </div>

      <div className="pm2-command-actions">
        {hasFields ? (
          <Button type="button" size="sm" variant="secondary" onClick={onConfigure} className="pm2-feature-options-button">
            <Settings2 size={14} />
            Options
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={feature.risk === "critical" ? "danger" : "primary"}
            disabled={running}
            onClick={onRun}
            className="pm2-feature-run"
          >
            {feature.risk === "critical" ? <AlertTriangle size={14} /> : <Play size={14} />}
            {running ? "Running..." : "Run"}
          </Button>
        )}
      </div>
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
