import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { auth } from "../api";

export default function Login() {
  const navigate = useNavigate();
  const [checkingSession, setCheckingSession] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    auth
      .me()
      .then((result) => {
        if (!mounted) {
          return;
        }
        if (result?.success) {
          navigate("/dashboard", { replace: true });
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => {
        if (mounted) {
          setCheckingSession(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      await toast.promise(
        auth.login(username, password).then((result) => {
          if (!result.success) {
            throw new Error(result.error || "Login failed");
          }
          return result;
        }),
        {
          loading: "Signing in...",
          success: "Signed in",
          error: (error) => getErrorMessage(error, "Login failed")
        }
      );

      const me = await auth.me();
      if (!me?.success) {
        throw new Error("Session validation failed after login");
      }
      navigate("/dashboard", { replace: true });
    } catch (_error) {
      // Toast is handled by toast.promise.
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-lg font-bold text-slate-900">PM2</div>
          <h1 className="text-2xl font-semibold text-slate-100">PM2 Dashboard</h1>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-slate-100 outline-none focus:border-green-500"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-slate-100 outline-none focus:border-green-500"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-green-600 px-4 py-3 font-medium text-white transition hover:bg-green-500 disabled:opacity-70"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
