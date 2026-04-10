export const semanticToneClasses = {
  success: {
    badge: "border border-success-500/30 bg-success-500/15 text-success-300",
    banner: "border-success-500/40 bg-success-500/10 text-success-300",
    text: "text-success-300",
    outlineButton: "border border-success-500/60 bg-transparent text-success-300 hover:bg-success-500/10 focus-visible:ring-success-300"
  },
  danger: {
    badge: "border border-danger-500/30 bg-danger-500/15 text-danger-300",
    banner: "border-danger-500/40 bg-danger-500/10 text-danger-300",
    text: "text-danger-300",
    outlineButton: "border border-danger-500/60 bg-transparent text-danger-300 hover:bg-danger-500/10 focus-visible:ring-danger-300"
  },
  warning: {
    badge: "border border-warning-500/30 bg-warning-500/15 text-warning-300",
    banner: "border-warning-500/40 bg-warning-500/10 text-warning-300",
    text: "text-warning-300",
    outlineButton: "border border-warning-500/60 bg-transparent text-warning-300 hover:bg-warning-500/10 focus-visible:ring-warning-300"
  },
  info: {
    badge: "border border-info-500/30 bg-info-500/15 text-info-300",
    banner: "border-info-500/40 bg-info-500/10 text-info-300",
    text: "text-info-300",
    outlineButton: "border border-info-500/60 bg-transparent text-info-300 hover:bg-info-500/10 focus-visible:ring-info-300"
  },
  neutral: {
    badge: "border border-border/80 bg-surface-2/80 text-text-2",
    banner: "border-border bg-surface-2 text-text-2",
    text: "text-text-2",
    outlineButton: "border border-border/90 bg-transparent text-text-2 hover:bg-surface-2 focus-visible:ring-brand-400"
  }
};

export function getSemanticToneClasses(tone = "neutral") {
  return semanticToneClasses[tone] || semanticToneClasses.neutral;
}

export function getSemanticOutlineButtonClasses(tone = "neutral") {
  return getSemanticToneClasses(tone).outlineButton;
}

export function processStatusTone(status) {
  switch (String(status || "").toLowerCase()) {
    case "online":
      return "success";
    case "stopped":
      return "warning";
    case "errored":
      return "danger";
    default:
      return "neutral";
  }
}
