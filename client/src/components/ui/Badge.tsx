import { cn } from "../../lib/cn";
import { getSemanticToneClasses } from "./semanticTones";

export default function Badge({ tone = "neutral", className, children }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", getSemanticToneClasses(tone).badge, className)}>
      {children}
    </span>
  );
}
