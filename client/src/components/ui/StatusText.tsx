import { cn } from "../../lib/cn";
import { getSemanticToneClasses } from "./semanticTones";

export default function StatusText({ as: Comp = "span", tone = "neutral", className, ...props }) {
  return <Comp className={cn("font-medium", getSemanticToneClasses(tone).text, className)} {...props} />;
}
