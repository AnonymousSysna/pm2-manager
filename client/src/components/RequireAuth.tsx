// @ts-nocheck
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { auth } from "../api";
import { Skeleton } from "./ui/Skeleton";

const AUTH_CHECK_RETRIES = 5;
const AUTH_CHECK_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function RequireAuth() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let mounted = true;

    const runCheck = async () => {
      for (let attempt = 0; attempt < AUTH_CHECK_RETRIES; attempt += 1) {
        try {
          const result = await auth.me();
          if (!mounted) {
            return;
          }
          if (result?.success) {
            setStatus("authenticated");
            return;
          }
        } catch (_error) {
          // Retry shortly to avoid race right after login cookie is set.
        }

        if (attempt < AUTH_CHECK_RETRIES - 1) {
          await sleep(AUTH_CHECK_DELAY_MS);
          if (!mounted) {
            return;
          }
        }
      }

      if (mounted) {
        setStatus("unauthenticated");
      }
    };

    runCheck();

    return () => {
      mounted = false;
    };
  }, []);

  if (status === "checking") {
    return <AuthCheckSkeleton />;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function AuthCheckSkeleton() {
  return (
    <div className="min-h-screen bg-bg text-text-1">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-layout items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md md:hidden" />
            <Skeleton className="hidden h-8 w-8 rounded-full md:block" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-36" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-layout gap-4 px-4 py-4 md:px-6 md:py-6">
        <aside className="hidden w-64 shrink-0 rounded-xl border border-border bg-surface p-4 md:block">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
          <Skeleton className="mt-6 h-10 w-full" />
        </aside>
        <main className="min-w-0 flex-1 space-y-4">
          <section className="page-panel page-intro space-y-3">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </section>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="page-panel">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-8 w-16" />
              </div>
            ))}
          </section>
          <section className="page-panel">
            <Skeleton className="mb-4 h-6 w-32" />
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-border bg-surface-2 p-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="col-span-2 h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

