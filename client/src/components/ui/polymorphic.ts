/**
 * Props for a component that renders as a caller-chosen element.
 *
 * Audit finding: the design-system primitives destructured `{ as: Comp = "div",
 * ...props }` with no annotations. Under `noImplicitAny: false` that let the tag
 * infer as `string` and the spread as `{}`, so TypeScript rejected every
 * `<Comp className=... {...props} />` and, worse, could not check call sites:
 * a misspelled or missing prop on a design-system component produced a
 * confusing error, or none at all.
 */
import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * `OwnProps` wins over the element's own props, and `as`/`className` are always
 * ours. Declaring an e.g. `size` prop that narrows the element's `size` is the
 * intended use.
 */
export type PolymorphicProps<E extends ElementType, OwnProps = {}> = OwnProps &
  Omit<ComponentPropsWithoutRef<E>, keyof OwnProps | "as" | "className"> & {
    /** Element or component to render. Defaults to the primitive's own tag. */
    as?: E;
    className?: string;
  };

/**
 * Resolves the tag for rendering. The cast is deliberate: `as` is dynamic, and
 * the contract that matters is enforced at the call site by
 * `PolymorphicProps`, not here.
 */
export type ButtonAttrs = {
  /**
   * The element's own `type` is deferred behind the generic tag, so pinning it
   * here keeps a default such as "button" assignable at the call site.
   */
  type?: "button" | "submit" | "reset";
};

export function resolveTag(as: unknown, fallback: ElementType): any {
  return as || fallback;
}
