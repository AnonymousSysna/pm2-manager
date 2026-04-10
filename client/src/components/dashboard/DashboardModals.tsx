import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import Field from "../ui/Field";
import Input from "../ui/Input";
import { ConfirmDialog } from "../ui/Modal";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import { Skeleton } from "../ui/Skeleton";

export function DeployProcessModal({
  process,
  deployForm,
  setDeployForm,
  submitDeployModal,
  deploySubmitting,
  deployElapsedSec,
  loadingAction,
  npmCapabilitiesByProcess,
  onClose
}) {
  if (!process) {
    return null;
  }

  return (
    <Modal
      title={`Deploy ${process.name}`}
      description="Pull the target branch, run optional install and build steps, then restart the process."
      onClose={onClose}
      disableClose={deploySubmitting}
      disableOverlayClose={deploySubmitting}
    >
      <div className="space-y-4">
        {deploySubmitting && (
          <div className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
            <div className="flex items-center gap-2 text-sm text-text-2">
              <Skeleton className="h-4 w-24 rounded-full" />
              Deployment running. Keep this tab open.
            </div>
            <p className="mt-1 text-xs text-text-3">Elapsed {deployElapsedSec}s</p>
            {deployElapsedSec >= 300 && (
              <p className="mt-1 text-xs text-warning-300">
                This is taking longer than expected. Check git access, build output, and network access on the host.
              </p>
            )}
          </div>
        )}

        <Field label="Branch override">
          <Input
            value={deployForm.branch}
            onChange={(event) => setDeployForm((prev) => ({ ...prev, branch: event.target.value }))}
            placeholder="Leave blank to deploy the current branch"
            disabled={deploySubmitting}
          />
        </Field>

        {Boolean(npmCapabilitiesByProcess[process.name]?.hasPackageJson) ? (
          <label className="flex items-center gap-2 text-sm text-text-2">
            <Checkbox
              checked={deployForm.installDependencies}
              disabled={deploySubmitting}
              onChange={(event) => setDeployForm((prev) => ({ ...prev, installDependencies: event.target.checked }))}
            />
            Run npm install
          </label>
        ) : (
          <p className="text-xs text-text-3">`npm install` is unavailable because no package.json was detected.</p>
        )}

        {Boolean(npmCapabilitiesByProcess[process.name]?.hasBuildScript) ? (
          <label className="flex items-center gap-2 text-sm text-text-2">
            <Checkbox
              checked={deployForm.runBuild}
              disabled={deploySubmitting}
              onChange={(event) => setDeployForm((prev) => ({ ...prev, runBuild: event.target.checked }))}
            />
            Run npm run build
          </label>
        ) : (
          <p className="text-xs text-text-3">`npm run build` is unavailable because no build script was detected.</p>
        )}

        <Field label="After deploy">
          <Select
            value={deployForm.restartMode}
            onChange={(event) => setDeployForm((prev) => ({ ...prev, restartMode: event.target.value }))}
            disabled={deploySubmitting}
          >
            <option value="restart">Restart</option>
            <option value="reload">Reload</option>
          </Select>
        </Field>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={deploySubmitting} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outlineInfo"
          disabled={deploySubmitting || loadingAction[`${process.name}:deploy`]}
          onClick={submitDeployModal}
        >
          {deploySubmitting ? "Deploying..." : "Start deploy"}
        </Button>
      </div>
    </Modal>
  );
}

export function ProcessMetaModal({
  process,
  metaForm,
  setMetaForm,
  metaSaving,
  onClose,
  onSubmit,
  onReset
}) {
  if (!process) {
    return null;
  }

  return (
    <Modal
      title={`Thresholds and dependencies: ${process.name}`}
      description="Store restart dependencies and alert thresholds with the process."
      onClose={onClose}
      size="lg"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Depends on">
          <Input
            value={metaForm.dependencies}
            onChange={(event) => setMetaForm((prev) => ({ ...prev, dependencies: event.target.value }))}
            placeholder="redis-worker, db-sync"
          />
        </Field>
        <Field label="CPU alert threshold (%)">
          <Input
            value={metaForm.cpuThreshold}
            onChange={(event) => setMetaForm((prev) => ({ ...prev, cpuThreshold: event.target.value }))}
            placeholder="80"
          />
        </Field>
        <Field label="Memory alert threshold (MB)">
          <Input
            value={metaForm.memoryThreshold}
            onChange={(event) => setMetaForm((prev) => ({ ...prev, memoryThreshold: event.target.value }))}
            placeholder="512"
          />
        </Field>
      </div>

      <div className="mt-4 flex justify-between gap-2">
        <Button type="button" variant="danger" disabled={metaSaving} onClick={onReset}>
          Clear saved rules
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="success" disabled={metaSaving} onClick={onSubmit}>
            Save rules
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function DotEnvEditorModal({
  process,
  dotEnvLoading,
  dotEnvSaving,
  dotEnvRevealValues,
  setDotEnvRevealValues,
  dotEnvValidationError,
  dotEnvFields,
  updateDotEnvFieldValue,
  submitDotEnvModal,
  onClose
}) {
  if (!process) {
    return null;
  }

  return (
    <Modal
      title={`Environment file: ${process.name}`}
      description="Edit values parsed from the current .env file. Sensitive keys stay masked unless you reveal them."
      onClose={onClose}
      size="xl"
      disableClose={dotEnvSaving}
      disableOverlayClose={dotEnvSaving}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-3">Only existing `KEY=VALUE` entries are editable here.</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={dotEnvLoading || dotEnvSaving}
          onClick={() => setDotEnvRevealValues((prev) => !prev)}
        >
          {dotEnvRevealValues ? "Mask sensitive values" : "Reveal sensitive values"}
        </Button>
      </div>

      {dotEnvLoading ? (
        <DotEnvEditorSkeleton />
      ) : (
        <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-border/80 bg-surface-2/70 p-3">
          {dotEnvValidationError && (
            <div className="rounded-lg border border-warning-500/40 bg-warning-500/10 p-2 text-xs text-warning-300">
              <p>{dotEnvValidationError}</p>
              <p className="mt-1">Fix malformed lines before saving changes.</p>
            </div>
          )}
          {dotEnvFields.length === 0 && (
            <p className="text-sm text-text-3">No editable entries were found.</p>
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
        <Button type="button" variant="secondary" disabled={dotEnvSaving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="success"
          disabled={dotEnvLoading || dotEnvSaving || Boolean(dotEnvValidationError)}
          onClick={submitDotEnvModal}
        >
          Review changes
        </Button>
      </div>
    </Modal>
  );
}

export function DotEnvDiffModal({
  open,
  process,
  dotEnvSaving,
  dotEnvRevealValues,
  dotEnvDiffEntries,
  confirmDotEnvSave,
  onClose
}) {
  if (!open || !process) {
    return null;
  }

  return (
    <Modal
      title="Review environment changes"
      description="Confirm the diff before writing it back to disk."
      onClose={onClose}
      size="lg"
      disableClose={dotEnvSaving}
      disableOverlayClose={dotEnvSaving}
      className="z-[60]"
    >
      <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-border/80 bg-surface-2/70 p-3">
        {dotEnvDiffEntries.map((entry) => (
          <div key={entry.key} className="rounded-lg border border-border/80 bg-surface px-3 py-2 text-sm">
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
        <Button type="button" variant="secondary" disabled={dotEnvSaving} onClick={onClose}>
          Back
        </Button>
        <Button type="button" variant="success" disabled={dotEnvSaving} onClick={confirmDotEnvSave}>
          {dotEnvSaving ? "Saving..." : "Write .env"}
        </Button>
      </div>
    </Modal>
  );
}

export function ProcessActionDialog({ actionDialog, loadingAction, onClose, onSubmit }) {
  if (!actionDialog) {
    return null;
  }

  if (actionDialog.mode === "confirm") {
    return (
      <ConfirmDialog
        title={actionDialog.title}
        description={actionDialog.description}
        confirmLabel={actionDialog.action === "delete" ? "Delete process" : "Confirm"}
        onClose={onClose}
        onConfirm={onSubmit}
        confirmDisabled={Boolean(loadingAction[`${actionDialog.name}:${actionDialog.action}`])}
      />
    );
  }

  if (actionDialog.mode !== "input") {
    return null;
  }

  return (
    <Modal
      title={actionDialog.title}
      description={actionDialog.description}
      onClose={onClose}
      size="md"
      actions={(
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={actionDialog.action === "rollback" ? "warning" : "info"}
            onClick={onSubmit}
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
          onChange={(event) => actionDialog.setValue(event.target.value)}
        />
      </Field>
      {Array.isArray(actionDialog.recentCommits) && actionDialog.recentCommits.length > 0 && (
        <div className="mt-3 rounded-lg border border-border/80 bg-surface-2/70 p-3 text-xs text-text-3">
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
  );
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
    <div className="rounded-lg border border-border/80 bg-surface-2/70 p-3" aria-hidden="true">
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
