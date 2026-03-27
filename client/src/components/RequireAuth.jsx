import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { auth } from "../api";

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
    return null;
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
