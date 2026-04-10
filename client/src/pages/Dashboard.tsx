// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { alerts as alertsApi, caddy as caddyApi, processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import ProcessDetailModal from "../components/ProcessDetailModal";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/Modal";
import Modal from "../components/ui/Modal";
import Select from "../components/ui/Select";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";
import StatCardsSection from "../components/dashboard/StatCardsSection";
import SystemResourcesPanel from "../components/dashboard/SystemResourcesPanel";
import DependencyGraphPanel from "../components/dashboard/DependencyGraphPanel";
import MetricsHistoryPanel from "../components/dashboard/MetricsHistoryPanel";
import ThresholdAlertsPanel from "../components/dashboard/ThresholdAlertsPanel";
import ProcessListPanel from "../components/dashboard/ProcessListPanel";

function bytesToMB(value) {
  return `${(Number(value || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function bytesToGB(value) {
  return `${(Number(value || 0) / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function uptimeLabel(ms) {
  if (!ms || ms < 0) {
    return "-";
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function durationLabel(ms) {
  if (!ms || ms <= 0) {
    return "0m";
  }
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

const SENSITIVE_ENV_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|private|credential|auth|pwd)/i;

function isSensitiveEnvKey(key) {
  return SENSITIVE_ENV_KEY_PATTERN.test(String(key || ""));
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { processes, alerts, monitorError, reconnecting } = useSocket();
  const [loadingAction, setLoadingAction] = useState({});
  const [query, setQuery] = useState("");
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [processMeta, setProcessMeta] = useState({});
  const [chartProcess, setChartProcess] = useState("");
  const [historyPoints, setHistoryPoints] = useState([]);
  const [monitoringSummary, setMonitoringSummary] = useState({});
  const [selectedNames, setSelectedNames] = useState({});
  const [editingMetaProcess, setEditingMetaProcess] = useState(null);
  const [metaForm, setMetaForm] = useState({
    dependencies: "",
    cpuThreshold: "",
    memoryThreshold: ""
  });
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaResetConfirmOpen, setMetaResetConfirmOpen] = useState(false);
  const [dotEnvByProcess, setDotEnvByProcess] = useState({});
  const [npmCapabilitiesByProcess, setNpmCapabilitiesByProcess] = useState({});
  const [editingDotEnvProcess, setEditingDotEnvProcess] = useState(null);
  const [dotEnvFields, setDotEnvFields] = useState([]);
  const [dotEnvOriginalValues, setDotEnvOriginalValues] = useState({});
  const [dotEnvLoading, setDotEnvLoading] = useState(false);
  const [dotEnvSaving, setDotEnvSaving] = useState(false);
  const [dotEnvRevealValues, setDotEnvRevealValues] = useState(false);
  const [dotEnvDiffOpen, setDotEnvDiffOpen] = useState(false);
  const [dotEnvDiffEntries, setDotEnvDiffEntries] = useState([]);
  const [dotEnvValidationError, setDotEnvValidationError] = useState("");
  const [deployingProcess, setDeployingProcess] = useState(null);
  const [deployForm, setDeployForm] = useState({
    branch: "",
    installDependencies: true,
    runBuild: true,
    restartMode: "restart"
  });
  const [deploySubmitting, setDeploySubmitting] = useState(false);
  const [deployStartedAt, setDeployStartedAt] = useState(0);
  const [deployElapsedSec, setDeployElapsedSec] = useState(0);
  const [actionDialog, setActionDialog] = useState(null);
  const [systemResources, setSystemResources] = useState(null);
  const [checklist, setChecklist] = useState({
    hasProcess: false,
    hasAlertChannel: false,
    hasStartupPersistence: localStorage.getItem("pm2_onboarding_startup_checked") === "true",
    hasDomain: false,
    dismissed: localStorage.getItem("pm2_onboarding_checklist_dismissed") === "true"
  });

  const refreshCatalog = async () => {
    try {
      const [catalogResult, summaryResult] = await Promise.all([
        processApi.catalog(),
        processApi.monitoringSummary()
      ]);

      if (catalogResult.success) {
        setProcessMeta(catalogResult.data.meta || {});
        const availability = {};
        const npmByProcess = {};
        for (const item of catalogResult.data.processes || []) {
          availability[item.name] = Boolean(item.hasDotEnvFile);
          npmByProcess[item.name] = {
            hasPackageJson: Boolean(item.npmCapabilities?.hasPackageJson),
            hasBuildScript: Boolean(item.npmCapabilities?.hasBuildScript)
          };
        }
        setDotEnvByProcess(availability);
        setNpmCapabilitiesByProcess(npmByProcess);
      }

      if (summaryResult.success && Array.isArray(summaryResult.data)) {
        const byName = {};
        for (const item of summaryResult.data) {
          byName[item.name] = item;
        }
        setMonitoringSummary(byName);
      }
    } catch (_error) {
      // Skip noisy toast for polling refresh.
    }
  };

  const refreshSystemResources = async () => {
    try {
      const result = await processApi.systemResources();
      if (result.success) {
        setSystemResources(result.data || null);
      }
    } catch (_error) {
      // Optional panel; keep previous values.
    }
  };

  const refreshOnboardingChecklist = async () => {
    try {
      const [processResult, channelResult, caddyResult] = await Promise.all([
        processApi.list(),
        alertsApi.listChannels(),
        caddyApi.status()
      ]);
      setChecklist((prev) => ({
        ...prev,
        hasProcess: Boolean(processResult?.success && Array.isArray(processResult.data) && processResult.data.length > 0),
        hasAlertChannel: Boolean(channelResult?.success && Array.isArray(channelResult.data) && channelResult.data.length > 0),
        hasDomain: Boolean(caddyResult?.success && Array.isArray(caddyResult.data?.managedSites) && caddyResult.data.managedSites.length > 0),
        hasStartupPersistence: prev.hasStartupPersistence || localStorage.getItem("pm2_onboarding_startup_checked") === "true"
      }));
    } catch (_error) {
      // Keep checklist best-effort.
    }
  };

  useEffect(() => {
    refreshCatalog();
    refreshSystemResources();
    refreshOnboardingChecklist();
    const timer = setInterval(refreshCatalog, 15000);
    const systemTimer = setInterval(refreshSystemResources, 20000);
    const checklistTimer = setInterval(refreshOnboardingChecklist, 30000);
    return () => {
      clearInterval(timer);
      clearInterval(systemTimer);
      clearInterval(checklistTimer);
    };
  }, []);

  useEffect(() => {
    if (!chartProcess && processes[0]?.name) {
      setChartProcess(processes[0].name);
    }
  }, [processes, chartProcess]);

  useEffect(() => {
    if (!chartProcess) {
      setHistoryPoints([]);
      return;
    }

    processApi
      .metrics(chartProcess, 180)
      .then((result) => {
        if (result.success && Array.isArray(result.data)) {
          setHistoryPoints(result.data);
        }
      })
      .catch(() => {
        setHistoryPoints([]);
      });
  }, [chartProcess]);

  useEffect(() => {
    if (!selectedProcess?.name) {
      return;
    }

    const live = processes.find((item) => item.name === selectedProcess.name);
    if (!live) {
      return;
    }

    setSelectedProcess((prev) => {
      if (!prev) {
        return prev;
      }
      if (
        prev.cpu === live.cpu &&
        prev.memory === live.memory &&
        prev.status === live.status &&
        prev.restarts === live.restarts
      ) {
        return prev;
      }
      return { ...prev, ...live };
    });
  }, [processes, selectedProcess?.name]);

  useEffect(() => {
    const known = new Set(processes.map((proc) => proc.name));
    setSelectedNames((prev) => {
      const next = {};
      Object.entries(prev).forEach(([name, isSelected]) => {
        if (isSelected && known.has(name)) {
          next[name] = true;
        }
      });
      return next;
    });
  }, [processes]);

  useEffect(() => {
    if (!deploySubmitting || !deployStartedAt) {
      setDeployElapsedSec(0);
      return undefined;
    }

    const tick = () => {
      setDeployElapsedSec(Math.max(0, Math.floor((Date.now() - deployStartedAt) / 1000)));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deploySubmitting, deployStartedAt]);

  useEffect(() => {
    if (!monitorError) {
      return;
    }
    toast.error(monitorError);
  }, [monitorError]);

  const openDetails = async (proc) => {
    try {
      const result = await processApi.get(proc.name);
      setSelectedProcess({
        ...proc,
        details: result.success ? result.data : null
      });
    } catch (_error) {
      setSelectedProcess(proc);
    }
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return processes;
    }

    return processes.filter(
      (item) =>
        item.name?.toLowerCase().includes(normalized) ||
        item.status?.toLowerCase().includes(normalized)
    );
  }, [processes, query]);

  const stats = useMemo(() => {
    const online = processes.filter((p) => p.status === "online").length;
    const stopped = processes.filter((p) => p.status === "stopped").length;
    const errored = processes.filter((p) => p.status === "errored").length;
    return { total: processes.length, online, stopped, errored };
  }, [processes]);

  const selectedCount = useMemo(
    () => Object.values(selectedNames).filter(Boolean).length,
    [selectedNames]
  );

  const checklistItems = useMemo(() => ([
    { key: "hasProcess", label: "Create your first process", done: checklist.hasProcess, to: "/dashboard/create" },
    { key: "hasAlertChannel", label: "Add an alert channel", done: checklist.hasAlertChannel, to: "/dashboard/settings" },
    { key: "hasStartupPersistence", label: "Enable startup persistence", done: checklist.hasStartupPersistence, to: "/dashboard/settings" },
    { key: "hasDomain", label: "Configure a domain in Caddy", done: checklist.hasDomain, to: "/dashboard/caddy" }
  ]), [checklist]);

  const checklistDoneCount = checklistItems.filter((item) => item.done).length;

  const dependencyEdges = useMemo(() => {
    const edges = [];
    const seen = new Set();

    Object.entries(processMeta || {}).forEach(([processName, meta]) => {
      const dependencies = Array.isArray(meta?.dependencies) ? meta.dependencies : [];
      dependencies.forEach((dependencyName) => {
        const from = String(processName || "").trim();
        const to = String(dependencyName || "").trim();
        if (!from || !to) {
          return;
        }
        const key = `${from}->${to}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        edges.push({ from, to });
      });
    });

    return edges.sort((a, b) => (`${a.from}:${a.to}`).localeCompare(`${b.from}:${b.to}`));
  }, [processMeta]);

  const executeAction = async (action, name, actionPayload) => {
    setLoadingAction((prev) => ({ ...prev, [`${name}:${action}`]: true }));
    try {
      const handlers = {
        start: processApi.start,
        stop: processApi.stop,
        restart: processApi.restart,
        reload: processApi.reload,
        npmInstall: processApi.npmInstall,
        npmBuild: processApi.npmBuild,
        gitPull: processApi.gitPull,
        schedule: (processName) => processApi.updateSchedule(processName, actionPayload?.cron_restart ?? null),
        duplicate: (processName) => processApi.duplicate(processName, actionPayload?.targetName || ""),
        deploy: (processName) => processApi.deploy(processName, actionPayload || {}),
        rollback: (processName) => processApi.rollback(processName, actionPayload || {}),
        delete: processApi.delete
      };
      const actionLabel = {
        start: "Start",
        stop: "Stop",
        restart: "Restart",
        reload: "Reload",
        npmInstall: "NPM install",
        npmBuild: "NPM build",
        gitPull: "Git pull",
        schedule: "Schedule restart",
        duplicate: "Duplicate",
        deploy: "Deploy",
        rollback: "Rollback",
        delete: "Delete"
      }[action] || action;

      await toast.promise(
        handlers[action](name).then((result) => {
          if (!result.success) {
            throw new Error(result.error || `Failed to ${action}`);
          }
          return result;
        }),
        {
          loading: `${actionLabel} in progress...`,
          success: `${actionLabel} completed for ${name}`,
          error: (error) => getErrorMessage(error, `Failed to ${action}`)
        }
      );
      refreshCatalog();
      if (selectedProcess?.name === name) {
        const latest = processes.find((item) => item.name === name) || selectedProcess;
        openDetails(latest);
      }
      return true;
    } catch (_error) {
      // Toast handled by toast.promise.
      return false;
    } finally {
      setLoadingAction((prev) => ({ ...prev, [`${name}:${action}`]: false }));
    }
  };

  const callAction = async (action, name, overridePayload) => {
    if (action === "deploy") {
      return executeAction(action, name, overridePayload || {});
    }

    if (action === "delete") {
      setActionDialog({
        mode: "confirm",
        action,
        name,
        title: `Delete ${name}`,
        description: "This removes the process from PM2 management."
      });
      return false;
    }

    if (action === "duplicate") {
      setActionDialog({
        mode: "input",
        action,
        name,
        title: `Duplicate ${name}`,
        description: "Create a new PM2 process using the same base configuration.",
        label: "New process name",
        placeholder: `${name}-copy`,
        value: `${name}-copy`,
        confirmLabel: "Duplicate Process"
      });
      return false;
    }

    if (action === "schedule") {
      const current = processes.find((item) => item.name === name)?.cronRestart || "";
      setActionDialog({
        mode: "input",
        action,
        name,
        title: `Schedule Restart: ${name}`,
        description: "Leave blank to disable. Example: 0 4 * * *",
        label: "Cron expression",
        placeholder: "0 4 * * *",
        value: current,
        confirmLabel: "Save Schedule"
      });
      return false;
    }

    if (action === "rollback") {
      try {
        const commitsResult = await processApi.gitCommits(name, 10);
        const commits = commitsResult?.success ? commitsResult.data?.commits || [] : [];
        setActionDialog({
          mode: "input",
          action,
          name,
          title: `Rollback ${name}`,
          description: "Leave blank to roll back to the previous commit (HEAD~1).",
          label: "Target commit (optional)",
          placeholder: "HEAD~1 or commit SHA",
          value: "",
          confirmLabel: "Run Rollback",
          recentCommits: commits.slice(0, 5)
        });
      } catch (error) {
        toast.error(getErrorMessage(error, "Unable to load recent commits"));
      }
      return false;
    }

    return executeAction(action, name, overridePayload);
  };

  const openDeployModal = (proc) => {
    const capabilities = npmCapabilitiesByProcess[proc.name] || {
      hasPackageJson: false,
      hasBuildScript: false
    };
    setDeployingProcess(proc);
    setDeployForm({
      branch: "",
      installDependencies: capabilities.hasPackageJson,
      runBuild: capabilities.hasBuildScript,
      restartMode: "restart"
    });
  };

  const submitDeployModal = async () => {
    if (!deployingProcess?.name) {
      return;
    }

    try {
      setDeploySubmitting(true);
      setDeployStartedAt(Date.now());
      const success = await callAction("deploy", deployingProcess.name, {
        branch: String(deployForm.branch || "").trim(),
        installDependencies: Boolean(deployForm.installDependencies),
        runBuild: Boolean(deployForm.runBuild),
        restartMode: deployForm.restartMode === "reload" ? "reload" : "restart"
      });
      if (success) {
        setDeployingProcess(null);
      }
    } finally {
      setDeploySubmitting(false);
      setDeployStartedAt(0);
    }
  };

  const openDeploymentHistoryForProcess = (name) => {
    navigate(`/dashboard/history?deploymentProcess=${encodeURIComponent(name)}`);
  };

  const toggleSelected = (name, checked) => {
    setSelectedNames((prev) => {
      if (checked) {
        return { ...prev, [name]: true };
      }
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const toggleSelectAllFiltered = (checked) => {
    if (!checked) {
      setSelectedNames({});
      return;
    }
    const next = {};
    filtered.forEach((proc) => {
      next[proc.name] = true;
    });
    setSelectedNames(next);
  };

  const runBulkAction = async (action) => {
    const names = filtered.filter((proc) => selectedNames[proc.name]).map((proc) => proc.name);
    if (names.length === 0) {
      toast.error("Select at least one process");
      return;
    }

    const actionLabel = {
      start: "Start",
      stop: "Stop",
      restart: "Restart"
    }[action] || action;

    try {
      const result = await toast.promise(
        processApi.bulkAction(action, names).then((response) => {
          if (!response || (!response.success && !response.data)) {
            throw new Error(response.error || `Failed to ${action} selected processes`);
          }
          return response;
        }),
        {
          loading: `${actionLabel} ${names.length} process(es)...`,
          success: `${actionLabel} request finished`,
          error: (error) => getErrorMessage(error, `Failed to ${action} selected processes`)
        }
      );

      const responseData = result?.data || {};
      const allResults = Array.isArray(responseData.results) ? responseData.results : [];
      const failed = allResults.filter((item) => !item.success);
      const succeeded = allResults.filter((item) => item.success);
      if (succeeded.length > 0) {
        toast.success(`${actionLabel}: ${succeeded.length} succeeded`);
      }
      if (failed.length > 0) {
        toast.error(`${actionLabel}: ${failed.length} failed (${failed.map((item) => item.name).join(", ")})`);
      }
      refreshCatalog();
    } catch (_error) {
      // Toast handled above.
    }
  };

  const openDotEnvModal = async (proc) => {
    if (!dotEnvByProcess[proc.name]) {
      toast.error(`No .env file found in ${proc.name} directory`);
      return;
    }

    setEditingDotEnvProcess(proc);
    setDotEnvLoading(true);
    setDotEnvFields([]);
    setDotEnvOriginalValues({});
    setDotEnvRevealValues(false);
    setDotEnvDiffEntries([]);
    setDotEnvDiffOpen(false);
    setDotEnvValidationError("");
    try {
      const result = await processApi.getDotEnv(proc.name);
      if (!result.success) {
        throw new Error(result.error || "Unable to load .env file");
      }
      if (!result.data?.hasEnvFile) {
        throw new Error(".env file is missing for this process");
      }
      const entries = Array.isArray(result.data?.entries) ? result.data.entries : [];
      const invalidLines = Array.isArray(result.data?.invalidLines) ? result.data.invalidLines : [];
      if (invalidLines.length > 0) {
        const lineList = invalidLines.slice(0, 5).map((item) => item.line).join(", ");
        setDotEnvValidationError(`Invalid .env syntax detected on line(s): ${lineList}`);
      }
      const originalByKey = {};
      entries.forEach((item) => {
        originalByKey[item.key] = String(item.value ?? "");
      });
      setDotEnvOriginalValues(originalByKey);
      setDotEnvFields(
        entries.map((item) => ({
          key: item.key,
          value: String(item.value ?? ""),
          valueType: item.valueType || "string",
          sensitive: isSensitiveEnvKey(item.key)
        }))
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load .env file"));
      setEditingDotEnvProcess(null);
    } finally {
      setDotEnvLoading(false);
    }
  };

  const submitDotEnvModal = async () => {
    if (!editingDotEnvProcess?.name) {
      return;
    }

    if (dotEnvValidationError) {
      toast.error(dotEnvValidationError);
      return;
    }

    const diffEntries = dotEnvFields
      .map((item) => {
        const before = String(dotEnvOriginalValues[item.key] ?? "");
        const after = String(item.value ?? "");
        if (before === after) {
          return null;
        }
        return {
          key: item.key,
          before,
          after,
          sensitive: Boolean(item.sensitive)
        };
      })
      .filter(Boolean);

    if (diffEntries.length === 0) {
      toast.info("No .env changes to save");
      return;
    }

    setDotEnvDiffEntries(diffEntries);
    setDotEnvDiffOpen(true);
  };

  const confirmDotEnvSave = async () => {
    if (!editingDotEnvProcess?.name) {
      return;
    }

    try {
      setDotEnvSaving(true);
      const values = {};
      dotEnvFields.forEach((item) => {
        values[item.key] = String(item.value ?? "");
      });

      await toast.promise(
        processApi.updateDotEnv(editingDotEnvProcess.name, values).then((response) => {
          if (!response.success) {
            throw new Error(response.error || "Unable to update .env file");
          }
          return response;
        }),
        {
          loading: `Updating .env for ${editingDotEnvProcess.name}...`,
          success: `.env updated for ${editingDotEnvProcess.name}`,
          error: (error) => getErrorMessage(error, "Failed to update .env file")
        }
      );
      setDotEnvDiffOpen(false);
      setEditingDotEnvProcess(null);
      setDotEnvFields([]);
      setDotEnvOriginalValues({});
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update .env file"));
    } finally {
      setDotEnvSaving(false);
    }
  };

  const openMetaModal = (proc) => {
    const current = processMeta[proc.name] || {};
    setEditingMetaProcess(proc);
    setMetaForm({
      dependencies: Array.isArray(current.dependencies) ? current.dependencies.join(", ") : "",
      cpuThreshold:
        current.alertThresholds?.cpu === null || current.alertThresholds?.cpu === undefined
          ? ""
          : String(current.alertThresholds.cpu),
      memoryThreshold:
        current.alertThresholds?.memoryMB === null || current.alertThresholds?.memoryMB === undefined
          ? ""
          : String(current.alertThresholds.memoryMB)
    });
  };

  const submitMetaModal = async () => {
    if (!editingMetaProcess?.name) {
      return;
    }

    const cpuThresholdValue = metaForm.cpuThreshold.trim();
    const memoryThresholdValue = metaForm.memoryThreshold.trim();

    if (cpuThresholdValue !== "" && Number.isNaN(Number(cpuThresholdValue))) {
      toast.error("CPU threshold must be a number");
      return;
    }

    if (memoryThresholdValue !== "" && Number.isNaN(Number(memoryThresholdValue))) {
      toast.error("Memory threshold must be a number");
      return;
    }

    const payload = {
      dependencies: metaForm.dependencies
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      alertThresholds: {
        cpu: cpuThresholdValue === "" ? null : Number(cpuThresholdValue),
        memoryMB: memoryThresholdValue === "" ? null : Number(memoryThresholdValue)
      }
    };

    try {
      setMetaSaving(true);
      const result = await processApi.setMeta(editingMetaProcess.name, payload);
      if (!result.success) {
        throw new Error(result.error || "Unable to update process metadata");
      }
      toast.success(`Updated metadata for ${editingMetaProcess.name}`);
      setEditingMetaProcess(null);
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to update process metadata"));
    } finally {
      setMetaSaving(false);
    }
  };

  const clearMetaForEditingProcess = async () => {
    if (!editingMetaProcess?.name || metaSaving) {
      return;
    }

    try {
      setMetaSaving(true);
      const result = await processApi.clearMeta(editingMetaProcess.name);
      if (!result.success) {
        throw new Error(result.error || "Unable to clear process metadata");
      }
      toast.success(`Cleared metadata for ${editingMetaProcess.name}`);
      setEditingMetaProcess(null);
      setActionDialog(null);
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to clear process metadata"));
    } finally {
      setMetaSaving(false);
    }
  };

  const updateDotEnvFieldValue = (index, nextValue) => {
    setDotEnvFields((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, value: nextValue } : item))
    );
  };

  const openLogsForProcess = (name) => {
    navigate(`/dashboard/logs?process=${encodeURIComponent(name)}`);
  };

  const openAppForPort = (port) => {
    try {
      openProcessUrl(port);
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to open app URL"));
    }
  };

  const submitActionDialog = async () => {
    if (!actionDialog?.action || !actionDialog?.name) {
      return;
    }

    const action = actionDialog.action;
    const name = actionDialog.name;
    let actionPayload;

    if (action === "duplicate") {
      const targetName = String(actionDialog.value || "").trim();
      if (!targetName) {
        toast.error("Duplicate target name is required");
        return;
      }
      actionPayload = { targetName };
    }

    if (action === "schedule") {
      actionPayload = { cron_restart: String(actionDialog.value || "").trim() || null };
    }

    if (action === "rollback") {
      actionPayload = { targetCommit: String(actionDialog.value || "").trim(), restartMode: "restart" };
    }

    const success = await executeAction(action, name, actionPayload);
    if (success) {
      setActionDialog(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageIntro
        title="Operations Dashboard"
        description="Monitor process health, inspect activity, and run lifecycle actions from a single control surface."
      />

      {reconnecting && (
        <div className="rounded-md border border-warning-500/40 bg-warning-500/15 px-3 py-2 text-sm text-warning-300">
          Reconnecting... Live process updates are temporarily paused.
        </div>
      )}
      {monitorError && (
        <div className="rounded-md border border-danger-500/40 bg-danger-500/15 px-3 py-2 text-sm text-danger-300">
          Monitor error: {monitorError}
        </div>
      )}

            <StatCardsSection stats={stats} />

      {!checklist.dismissed && (
        <section className="page-panel">
          <div className="mb-2 flex items-center justify-between gap-2">
            <PanelHeader title={`Setup Checklist (${checklistDoneCount}/${checklistItems.length})`} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                localStorage.setItem("pm2_onboarding_checklist_dismissed", "true");
                setChecklist((prev) => ({ ...prev, dismissed: true }));
              }}
            >
              Dismiss
            </Button>
          </div>
          <div className="space-y-2">
            {checklistItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Done" : "Todo"}</Badge>
                  <span className="text-text-2">{item.label}</span>
                </div>
                {!item.done && (
                  <Button type="button" size="sm" variant="outlineInfo" onClick={() => navigate(item.to)}>
                    Open
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <SystemResourcesPanel systemResources={systemResources} bytesToGB={bytesToGB} />

      <DependencyGraphPanel dependencyEdges={dependencyEdges} />

      <MetricsHistoryPanel
        chartProcess={chartProcess}
        onChartProcessChange={setChartProcess}
        processes={processes}
        historyPoints={historyPoints}
      />

      <ThresholdAlertsPanel alerts={alerts} />

      <ProcessListPanel
        filtered={filtered}
        monitoringSummary={monitoringSummary}
        selectedNames={selectedNames}
        toggleSelected={toggleSelected}
        toggleSelectAllFiltered={toggleSelectAllFiltered}
        selectedCount={selectedCount}
        runBulkAction={runBulkAction}
        query={query}
        setQuery={setQuery}
        openDetails={openDetails}
        openMetaModal={openMetaModal}
        openDotEnvModal={openDotEnvModal}
        openDeployModal={openDeployModal}
        openDeploymentHistoryForProcess={openDeploymentHistoryForProcess}
        dotEnvByProcess={dotEnvByProcess}
        npmCapabilitiesByProcess={npmCapabilitiesByProcess}
        loadingAction={loadingAction}
        callAction={callAction}
        onOpenLogs={openLogsForProcess}
        onOpenApp={openAppForPort}
        bytesToMB={bytesToMB}
        durationLabel={durationLabel}
      />

      {selectedProcess && (
        <ProcessDetailModal
          process={selectedProcess}
          onClose={() => setSelectedProcess(null)}
          onAction={callAction}
          onViewDeployHistory={openDeploymentHistoryForProcess}
        />
      )}

      {deployingProcess && (
        <Modal
          title={`Deploy: ${deployingProcess.name}`}
          onClose={() => setDeployingProcess(null)}
          disableClose={deploySubmitting}
          disableOverlayClose={deploySubmitting}
        >
          <>
            <div className="space-y-3">
              {deploySubmitting && (
                <div className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex items-center gap-2 text-sm text-text-2">
                    <Skeleton className="h-4 w-24 rounded-full" />
                    Deployment in progress. Keep this page open.
                  </div>
                  <p className="mt-1 text-xs text-text-3">Elapsed: {deployElapsedSec}s</p>
                  {deployElapsedSec >= 300 && (
                    <p className="mt-1 text-xs text-warning-300">
                      This deployment is taking unusually long (over 5 minutes). Check git access, build output, and network.
                    </p>
                  )}
                </div>
              )}
              <Field label="Branch (optional)">
                <Input
                  value={deployForm.branch}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, branch: e.target.value }))}
                  placeholder="leave blank for current branch"
                  disabled={deploySubmitting}
                />
              </Field>
              {Boolean(npmCapabilitiesByProcess[deployingProcess.name]?.hasPackageJson) ? (
                <label className="flex items-center gap-2 text-sm text-text-2">
                  <Checkbox
                    checked={deployForm.installDependencies}
                    disabled={deploySubmitting}
                    onChange={(e) => setDeployForm((prev) => ({ ...prev, installDependencies: e.target.checked }))}
                  />
                  Run npm install
                </label>
              ) : (
                <p className="text-xs text-text-3">npm install is hidden: no package.json in process directory.</p>
              )}
              {Boolean(npmCapabilitiesByProcess[deployingProcess.name]?.hasBuildScript) ? (
                <label className="flex items-center gap-2 text-sm text-text-2">
                  <Checkbox
                    checked={deployForm.runBuild}
                    disabled={deploySubmitting}
                    onChange={(e) => setDeployForm((prev) => ({ ...prev, runBuild: e.target.checked }))}
                  />
                  Run npm run build
                </label>
              ) : (
                <p className="text-xs text-text-3">npm run build is hidden: no build script in package.json.</p>
              )}
              <Field label="After deploy">
                <Select
                  value={deployForm.restartMode}
                  onChange={(e) => setDeployForm((prev) => ({ ...prev, restartMode: e.target.value }))}
                  disabled={deploySubmitting}
                >
                  <option value="restart">Restart</option>
                  <option value="reload">Reload</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={deploySubmitting} onClick={() => setDeployingProcess(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outlineInfo"
                disabled={deploySubmitting || loadingAction[`${deployingProcess.name}:deploy`]}
                onClick={submitDeployModal}
              >
                {deploySubmitting ? "Deploying..." : "Deploy"}
              </Button>
            </div>
          </>
        </Modal>
      )}

      {editingMetaProcess && (
        <Modal title={`Edit Metadata: ${editingMetaProcess.name}`} onClose={() => setEditingMetaProcess(null)} size="lg">
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Dependencies (comma-separated)">
                <Input
                  value={metaForm.dependencies}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, dependencies: e.target.value }))}
                  placeholder="redis-worker,db-sync"
                />
              </Field>
              <Field label="CPU alert threshold (%)">
                <Input
                  value={metaForm.cpuThreshold}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, cpuThreshold: e.target.value }))}
                  placeholder="80"
                />
              </Field>
              <Field label="Memory alert threshold (MB)">
                <Input
                  value={metaForm.memoryThreshold}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, memoryThreshold: e.target.value }))}
                  placeholder="512"
                />
              </Field>
            </div>
            <div className="mt-4 flex justify-between gap-2">
              <Button type="button" variant="danger" disabled={metaSaving} onClick={() => setMetaResetConfirmOpen(true)}>
                Reset Metadata
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditingMetaProcess(null)}>
                  Cancel
                </Button>
                <Button type="button" variant="success" disabled={metaSaving} onClick={submitMetaModal}>
                  Save Metadata
                </Button>
              </div>
            </div>
          </>
        </Modal>
      )}

      {editingDotEnvProcess && (
        <Modal
          title={`Edit .env: ${editingDotEnvProcess.name}`}
          onClose={() => setEditingDotEnvProcess(null)}
          size="xl"
          disableClose={dotEnvSaving}
          disableOverlayClose={dotEnvSaving}
        >
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-text-3">Fields are inferred from existing `.env` values.</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={dotEnvLoading || dotEnvSaving}
                onClick={() => setDotEnvRevealValues((prev) => !prev)}
              >
                {dotEnvRevealValues ? "Mask Sensitive Values" : "Reveal Sensitive Values"}
              </Button>
            </div>
            {dotEnvLoading ? (
              <DotEnvEditorSkeleton />
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border bg-surface-2 p-3">
                {dotEnvValidationError && (
                  <div className="rounded border border-warning-500/40 bg-warning-500/10 p-2 text-xs text-warning-300">
                    <p>{dotEnvValidationError}</p>
                    <p className="mt-1">Fix malformed `.env` lines before saving changes.</p>
                  </div>
                )}
                {dotEnvFields.length === 0 && (
                  <p className="text-sm text-text-3">No editable `KEY=VALUE` lines found in `.env`.</p>
                )}
                {dotEnvFields.map((item, index) => (
                  <div key={`${item.key}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-[220px,1fr] md:items-center">
                    <label className="text-xs font-semibold text-text-2">{item.key}</label>
                    <DotEnvValueInput
                      valueType={item.valueType}
                      value={item.value}
                      sensitive={item.sensitive}
                      revealed={dotEnvRevealValues}
                      disabled={dotEnvSaving}
                      onChange={(nextValue) => updateDotEnvFieldValue(index, nextValue)}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={dotEnvSaving}
                onClick={() => setEditingDotEnvProcess(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="success"
                disabled={dotEnvLoading || dotEnvSaving || Boolean(dotEnvValidationError)}
                onClick={submitDotEnvModal}
              >
                Save .env
              </Button>
            </div>
          </>
        </Modal>
      )}

      {dotEnvDiffOpen && editingDotEnvProcess && (
        <Modal
          title="Review .env Changes"
          onClose={() => setDotEnvDiffOpen(false)}
          size="lg"
          disableClose={dotEnvSaving}
          disableOverlayClose={dotEnvSaving}
          className="z-[60]"
        >
            <p className="mb-3 text-sm text-text-3">
              Confirm before saving to avoid accidental overwrite.
            </p>
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border bg-surface-2 p-3">
              {dotEnvDiffEntries.map((entry) => (
                <div key={entry.key} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  <p className="font-semibold text-text-1">{entry.key}</p>
                  <p className="text-xs text-text-3">
                    - {entry.sensitive && !dotEnvRevealValues ? "*****" : entry.before}
                  </p>
                  <p className="text-xs text-success-300">
                    + {entry.sensitive && !dotEnvRevealValues ? "*****" : entry.after}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={dotEnvSaving} onClick={() => setDotEnvDiffOpen(false)}>
                Back
              </Button>
              <Button type="button" variant="success" disabled={dotEnvSaving} onClick={confirmDotEnvSave}>
                {dotEnvSaving ? "Saving..." : "Confirm Save"}
              </Button>
            </div>
        </Modal>
      )}

      {actionDialog?.mode === "confirm" && (
        <ConfirmDialog
          title={actionDialog.title}
          description={actionDialog.description}
          confirmLabel={actionDialog.action === "delete" ? "Delete Process" : "Confirm"}
          onClose={() => setActionDialog(null)}
          onConfirm={submitActionDialog}
          confirmDisabled={Boolean(loadingAction[`${actionDialog.name}:${actionDialog.action}`])}
        />
      )}

      {actionDialog?.mode === "input" && (
        <Modal
          title={actionDialog.title}
          description={actionDialog.description}
          onClose={() => setActionDialog(null)}
          size="md"
          actions={(
            <>
              <Button type="button" variant="secondary" onClick={() => setActionDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={actionDialog.action === "rollback" ? "warning" : "info"}
                onClick={submitActionDialog}
                disabled={Boolean(loadingAction[`${actionDialog.name}:${actionDialog.action}`])}
              >
                {actionDialog.confirmLabel}
              </Button>
            </>
          )}
        >
          <Field label={actionDialog.label}>
            <Input
              value={actionDialog.value}
              placeholder={actionDialog.placeholder}
              onChange={(event) => setActionDialog((prev) => ({ ...prev, value: event.target.value }))}
            />
          </Field>
          {Array.isArray(actionDialog.recentCommits) && actionDialog.recentCommits.length > 0 && (
            <div className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-xs text-text-3">
              <p className="mb-2 font-semibold text-text-2">Recent commits</p>
              <div className="space-y-1">
                {actionDialog.recentCommits.map((item) => (
                  <p key={item.hash || item.shortHash}>
                    <span className="font-semibold text-text-2">{item.shortHash}</span> {item.subject}
                  </p>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

      {metaResetConfirmOpen && editingMetaProcess && (
        <ConfirmDialog
          title="Reset Metadata"
          description={`Clear saved metadata for ${editingMetaProcess.name}?`}
          confirmLabel="Reset Metadata"
          onClose={() => setMetaResetConfirmOpen(false)}
          onConfirm={async () => {
            await clearMetaForEditingProcess();
            setMetaResetConfirmOpen(false);
          }}
          confirmDisabled={metaSaving}
        />
      )}
    </div>
  );
}

function openProcessUrl(port) {
  const value = Number(port);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid process port");
  }
  const target = `${window.location.protocol}//${window.location.hostname}:${value}`;
  window.open(target, "_blank", "noopener,noreferrer");
}

function DotEnvValueInput({ valueType, value, onChange, disabled, sensitive = false, revealed = false }) {
  if (valueType === "boolean") {
    return (
      <Select
        value={String(value).toLowerCase() === "true" ? "true" : "false"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    );
  }

  if (valueType === "integer" || valueType === "number") {
    return (
      <Input
        type={sensitive && !revealed ? "password" : "number"}
        step={valueType === "integer" ? "1" : "any"}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      type={sensitive && !revealed ? "password" : "text"}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function DotEnvEditorSkeleton() {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3" aria-hidden="true">
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-[220px,1fr] md:items-center">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}


