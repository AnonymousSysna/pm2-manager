import type { ElementType } from "react";
import { cn } from "../../lib/cn";
import { ButtonAttrs, PolymorphicProps, resolveTag } from "./polymorphic";

const toneClasses = {
  brand: "text-brand-400 hover:underline focus-visible:ring-brand-400",
  neutral: "text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:ring-brand-400"
};

export default function TextButton<E extends ElementType = "button">({
  as,
  tone = "brand",
  className = "",
  type = "button",
  ...props
}: PolymorphicProps<E, { tone?: keyof typeof toneClasses } & ButtonAttrs>) {
  const Comp = resolveTag(as, "button");
  return (
    <Comp
      type={Comp === "button" ? type : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-medium underline-offset-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        toneClasses[tone] || toneClasses.brand,
        className
      )}
      {...props}
    />
  );
}
