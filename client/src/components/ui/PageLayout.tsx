// @ts-nocheck
import { cn } from "../../lib/cn";

export function PageIntro({ title, description, actions, className }) {
  return (
    <section className={cn("page-panel page-intro", className)}>
      <div className="panel-title-row">
        <div>
          <h2 className="section-title">{title}</h2>
          {description ? <p className="panel-muted mt-1">{description}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function PanelHeader({ title, description, actions, className }) {
  return (
    <div className={cn("panel-title-row", className)}>
      <div>
        <h3 className="section-title">{title}</h3>
        {description ? <p className="panel-muted mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="panel-actions">{actions}</div> : null}
    </div>
  );
}

