import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type HeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageIntro({ title, description, actions, className }: HeaderProps) {
  return (
    <section className={cn("page-panel page-intro", className)}>
      <div className="panel-title-row">
        <div>
          <h1 className="page-heading">{title}</h1>
          {description ? <p className="panel-muted mt-1">{description}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function PanelHeader({ title, description, actions, className }: HeaderProps) {
  return (
    <div className={cn("panel-title-row", className)}>
      <div>
        <h2 className="panel-heading">{title}</h2>
        {description ? <p className="panel-muted mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="panel-actions">{actions}</div> : null}
    </div>
  );
}

