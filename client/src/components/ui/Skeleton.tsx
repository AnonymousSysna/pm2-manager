// @ts-nocheck
import { cn } from "../../lib/cn";

export function Skeleton({ className, ...props }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-3/80", className)}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className, lineClassName }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          // Keep the final line shorter so text blocks look less mechanical.
          key={index}
          className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full", lineClassName)}
        />
      ))}
    </div>
  );
}
