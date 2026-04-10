import { cn } from "../../lib/cn";
import { getSemanticToneClasses } from "./semanticTones";

export default function Banner({ tone = "neutral", icon, className, children }) {
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", getSemanticToneClasses(tone).banner, className)}>
      <div className="flex items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
