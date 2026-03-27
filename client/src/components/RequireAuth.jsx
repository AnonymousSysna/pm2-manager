import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { auth } from "../api";

export default function RequireAuth() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let mounted = true;

    auth
      .me()
      .then((result) => {
        if (!mounted) {
          return;
        }
        setStatus(result?.success ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (mounted) {
          setStatus("unauthenticated");
        }
      });

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
