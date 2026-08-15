"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, Loader2, Lock } from "lucide-react";
import { ApiError, isLive } from "@/lib/api";
import { portalForgotPassword } from "@/lib/portal-live";
import { Button, Card } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm " +
  "outline-none ring-offset-background placeholder:text-muted-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function PortalForgotPasswordPage() {
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await portalForgotPassword(slug, username);
      setSent(true);
      setChallengeId(res.challenge_id ?? null);
      if (res.dev_otp) setDevOtp(res.dev_otp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!isLive) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-6 text-center text-sm text-muted-foreground">
          Password recovery is a live-backend feature. Run the app in live mode
          to reset a resident&apos;s password.
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            CH
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Resident Portal</p>
            <p className="text-xs text-muted-foreground">Reset your password</p>
          </div>
        </div>

        <Card>
          {sent ? (
            <div className="flex flex-col gap-4">
              <h1 className="text-xl font-semibold tracking-tight">Check your inbox</h1>
              <p className="text-sm text-muted-foreground">
                If that username exists in this community, a one-time code has
                been sent. Enter it on the next screen along with your new
                password.
              </p>
              {devOtp && (
                <div className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Dev only — your one-time code: <strong>{devOtp}</strong>
                </div>
              )}
              {challengeId && (
                <a
                  href={`/portal/reset-password?challenge=${encodeURIComponent(challengeId)}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  I have the code
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
              <button
                onClick={() => setSent(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Try again
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
              <p className="text-sm text-muted-foreground">
                Enter your community and username and we&apos;ll email or text a
                one-time code.
              </p>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pf-slug" className="text-sm font-medium">
                  Community
                </label>
                <input
                  id="pf-slug"
                  type="text"
                  autoComplete="organization"
                  required
                  className={fieldClass}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="your-community-slug"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pf-username" className="text-sm font-medium">
                  Username
                </label>
                <input
                  id="pf-username"
                  type="text"
                  autoComplete="username"
                  required
                  className={fieldClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="jdoe"
                />
              </div>

              <Button type="submit" disabled={busy} className="mt-1 w-full">
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send reset code"
                )}
              </Button>

              <a
                href="/portal/login"
                className="text-center text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to sign in
              </a>
            </form>
          )}
        </Card>

        <a
          href="/login"
          className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Lock className="h-3 w-3" />
          Staff sign-in is a different door
        </a>
      </div>
    </div>
  );
}
