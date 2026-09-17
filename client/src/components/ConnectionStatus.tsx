import Badge from "./ui/Badge";
import Banner from "./ui/Banner";
import { useConnectionState } from "../hooks/useConnectionState";

/**
 * One place for connection copy, so the shell and the dashboard cannot disagree
 * about what "Offline" means or whether actions still work.
 */
export function ConnectionBanner() {
  const { status, message } = useConnectionState();
  if (!message) {
    return null;
  }
  return <Banner tone={status === "offline" ? "danger" : "warning"}>{message}</Banner>;
}

export function ConnectionBadge() {
  const { status, badgeLabel } = useConnectionState();
  const tone = status === "live" ? "success" : status === "reconnecting" ? "warning" : "danger";
  return <Badge tone={tone}>{badgeLabel}</Badge>;
}
