"use client";

/**
 * Credential login against the real backend (NEXT_PUBLIC_DATA_MODE=live).
 *
 * The demo's persona picker is deliberately not reachable here: in live mode
 * who you are is decided by the server, and the permissions the UI gates on
 * come back from /auth/me rather than from the local RBAC table.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "../providers";
import { ApiError } from "@/lib/api";
import { Button, Card, PasswordInput} from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

export default function LiveLogin() {
  const { signInWithPassword } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email.trim(), password, mfaCode.trim() || undefined);
      router.push("/dashboard");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Something went wrong signing in.";
      // The backend answers a missing second factor with 401 "MFA code required".
      if (/mfa/i.test(msg)) {
        setMfaNeeded(true);
        setError(mfaCode ? "That code wasn't accepted. Try the current one." : null);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm " +
    "outline-none ring-offset-background placeholder:text-muted-foreground " +
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Casa Harmony</h1>
            <p className="text-sm text-muted-foreground">Sign in to your association</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className={field}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@association.org"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <PasswordInput
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className={field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mfaNeeded && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mfa" className="text-sm font-medium">
                Authentication code
              </label>
              <input
                id="mfa"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className={field}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="6-digit code"
              />
              <p className="text-xs text-muted-foreground">
                From your authenticator app.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm">
          <a href="/forgot-password" className="text-muted-foreground hover:text-foreground">
            Forgot password?
          </a>
          <a
            href="/portal/login"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Lock className="h-3.5 w-3.5" />
            Resident portal
          </a>
        </div>
      </Card>
    </div>
  );
}
