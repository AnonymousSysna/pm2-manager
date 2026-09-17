import { cn } from "../../lib/cn";
import { getSemanticToneClasses } from "./semanticTones";

export default function Badge({ tone = "neutral", className = "", children }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", getSemanticToneClasses(tone).badge, className)}>
      {children}
    </span>
  );
}
