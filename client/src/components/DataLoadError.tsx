import { AlertTriangle } from "lucide-react";
import Banner from "./ui/Banner";
import Button from "./ui/Button";

/**
 * A read that failed must not look like a read that returned nothing.
 *
 * Audit finding: several panels swallowed load failures and then rendered their
 * empty-state copy, so "No deployments." and an empty chart were shown for a
 * server error, a timeout, or an expired session. This keeps the failure visible
 * next to the surface that failed, with the retry action in reach.
 */
export default function DataLoadError({ message, onRetry = null, retryLabel = "Retry", className = "" }) {
  return (
    <Banner tone="danger" icon={<AlertTriangle size={16} />} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="min-w-0">{message}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outlineDanger" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </Banner>
  );
}
