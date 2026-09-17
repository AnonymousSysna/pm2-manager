import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type HeaderProps = {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageIntro({ title, actions, className = "" }: HeaderProps) {
  return (
    <section className={cn("page-panel page-intro", className)}>
      <div className="panel-title-row">
        <div className="min-w-0">
          <h1 className="page-heading">{title}</h1>
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function PanelHeader({ title, actions, className = "" }: HeaderProps) {
  return (
    <div className={cn("panel-title-row", className)}>
      <div className="min-w-0">
        <h2 className="panel-heading">{title}</h2>
      </div>
      {actions ? <div className="panel-actions">{actions}</div> : null}
    </div>
  );
}

