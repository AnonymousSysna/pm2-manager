// @ts-nocheck
import { cn } from "../../lib/cn";

const paddings = {
  sm: "p-2",
  md: "p-3"
};

export default function InsetPanel({ as: Comp = "div", padding = "md", className, ...props }) {
  return <Comp className={cn("rounded-md border border-border bg-surface-2", paddings[padding] || paddings.md, className)} {...props} />;
}
