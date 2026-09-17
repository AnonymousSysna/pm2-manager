import type { ElementType, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { PolymorphicProps, resolveTag } from "./polymorphic";
import { Eyebrow, MetricValue, SupportingCopy } from "./Typography";

const panelPaddingMap = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5"
};

const insetPaddingMap = {
  sm: "p-2",
  md: "p-3",
  lg: "p-4"
};

const insetToneMap = {
  muted: "bg-surface-2/70",
  surface: "bg-surface",
  elevated: "bg-surface-2/80"
};

export function Panel<E extends ElementType = "section">({
  as,
  padding = "md",
  className = "",
  ...props
}: PolymorphicProps<E, { padding?: keyof typeof panelPaddingMap }>) {
  const Comp = resolveTag(as, "section");
  return <Comp className={cn("page-panel", panelPaddingMap[padding] || panelPaddingMap.md, className)} {...props} />;
}

export function InsetCard<E extends ElementType = "div">({
  as,
  padding = "md",
  tone = "muted",
  className = "",
  ...props
}: PolymorphicProps<E, { padding?: keyof typeof insetPaddingMap; tone?: keyof typeof insetToneMap }>) {
  const Comp = resolveTag(as, "div");
  return (
    <Comp
      className={cn("inset-card", insetPaddingMap[padding] || insetPaddingMap.md, insetToneMap[tone] || insetToneMap.muted, className)}
      {...props}
    />
  );
}

type StatCardProps = {
  label?: ReactNode;
  value?: ReactNode;
  note?: ReactNode;
  valueClassName?: string;
  className?: string;
  tone?: keyof typeof insetToneMap;
};

export function StatCard({ label, value, note, valueClassName, className = "", tone = "muted" }: StatCardProps) {
  return (
    <InsetCard tone={tone} className={className}>
      <Eyebrow>{label}</Eyebrow>
      <MetricValue className="mt-2">
        <span className={valueClassName}>{value}</span>
      </MetricValue>
      {note ? <SupportingCopy size="xs" className="mt-1">{note}</SupportingCopy> : null}
    </InsetCard>
  );
}
