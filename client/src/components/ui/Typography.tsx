import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { PolymorphicProps, resolveTag } from "./polymorphic";

export function Eyebrow<E extends ElementType = "p">({ as, className = "", ...props }: PolymorphicProps<E>) {
  const Comp = resolveTag(as, "p");
  return <Comp className={cn("meta-label", className)} {...props} />;
}

export function SubsectionTitle<E extends ElementType = "h3">({ as, className = "", ...props }: PolymorphicProps<E>) {
  const Comp = resolveTag(as, "h3");
  return <Comp className={cn("subsection-title", className)} {...props} />;
}

export function MetricValue<E extends ElementType = "p">({ as, className = "", ...props }: PolymorphicProps<E>) {
  const Comp = resolveTag(as, "p");
  return <Comp className={cn("metric-value", className)} {...props} />;
}

type SupportingCopyProps = {
  tone?: "default" | "muted";
  size?: "sm" | "xs";
  children?: ReactNode;
};

export function SupportingCopy<E extends ElementType = "p">({
  as,
  tone = "muted",
  size = "sm",
  className = "",
  ...props
}: PolymorphicProps<E, SupportingCopyProps>) {
  const Comp = resolveTag(as, "p");
  return (
    <Comp
      className={cn(
        size === "xs" ? "text-xs" : "text-sm",
        tone === "default" ? "text-text-2" : "text-text-3",
        className
      )}
      {...props}
    />
  );
}
