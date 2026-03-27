import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { auth } from "../api";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    let authenticated = false;

    try {
      await toast.promise(
        auth.login(username, password).then((result) => {
          if (!result.success) {
            throw new Error(result.error || "Login failed");
          }
          authenticated = true;
          return result;
        }),
        {
          loading: "Signing in...",
          success: "Signed in",
          error: (error) => getErrorMessage(error, "Login failed")
        }
      );

      if (authenticated) {
        navigate("/dashboard", { replace: true });
      }
    } catch (_error) {
      // Toast is handled by toast.promise.
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-2xl shadow-black/30">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-lg font-bold text-bg">PM2</div>
          <h1 className="page-title">PM2 Manager</h1>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
          <Button type="submit" variant="success" disabled={loading} className="w-full">
            {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
