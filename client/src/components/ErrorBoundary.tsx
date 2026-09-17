import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "./ui/Button";
import { SupportingCopy } from "./ui/Typography";
import { errorReporter } from "../lib/errorReporter";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** "page" fills the viewport (app shell is gone); "inline" keeps the surrounding chrome usable. */
  variant?: "page" | "inline";
  title?: string;
  description?: string;
  /** Change this value to auto-clear the error, e.g. the current route. */
  resetKey?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
  onReset?: () => void;
};

type ErrorBoundaryState = {
  error: Error | null;
  reference: string;
};

function newReference() {
  try {
    return `E${Date.now().toString(36).toUpperCase()}`;
  } catch (_error) {
    return "E-UNKNOWN";
  }
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, reference: "" };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, reference: newReference() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    errorReporter.reportReactError(error, info, { extra: { reference: this.state.reference } });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reference: "" });
      this.props.onReset?.();
    }
  }

  reset = () => {
    this.setState({ error: null, reference: "" });
    this.props.onReset?.();
  };

  reload = () => {
    window.location.reload();
  };

  render() {
    const { error, reference } = this.state;
    if (!error) {
      return this.props.children;
    }

    const variant = this.props.variant || "inline";
    const title = this.props.title || "This screen stopped responding";
    const description =
      this.props.description ||
      "The error was reported automatically. Retrying usually restores the view; reloading clears any stuck state.";

    const panel = (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger-300" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-text-1">{title}</p>
            <SupportingCopy>{description}</SupportingCopy>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={this.reset}>
            <RotateCw size={14} />
            Try again
          </Button>
          <Button variant="outline" size="sm" onClick={this.reload}>
            Reload app
          </Button>
          <SupportingCopy as="span" size="xs" className="ml-auto font-mono">
            {reference}
          </SupportingCopy>
        </div>
        <details className="text-xs text-text-3">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <pre className="stack-trace">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </details>
      </div>
    );

    if (variant === "page") {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-text-1">
          <div role="alert" className="w-full max-w-lg rounded-xl border border-danger-500/40 bg-surface p-5">
            {panel}
            <a className="mt-3 inline-block text-xs text-text-3 underline hover:text-text-2" href="/dashboard">
              Back to overview
            </a>
          </div>
        </div>
      );
    }

    return (
      <div role="alert" className="rounded-xl border border-danger-500/40 bg-surface p-4">
        {panel}
      </div>
    );
  }
}
