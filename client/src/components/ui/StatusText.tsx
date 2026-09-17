import type { ElementType } from "react";
import { cn } from "../../lib/cn";
import { PolymorphicProps, resolveTag } from "./polymorphic";
import { getSemanticToneClasses } from "./semanticTones";

export default function StatusText<E extends ElementType = "span">({
  as,
  tone = "neutral",
  className = "",
  ...props
}: PolymorphicProps<E, { tone?: string }>) {
  const Comp = resolveTag(as, "span");
  return <Comp className={cn("font-medium", getSemanticToneClasses(tone).text, className)} {...props} />;
}
