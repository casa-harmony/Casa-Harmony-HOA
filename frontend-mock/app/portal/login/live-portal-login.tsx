"use client";

/**
 * Real-backend portal login for homeowners (NEXT_PUBLIC_DATA_MODE=live).
 *
 * The portal uses a separate two-step authentication:
 *   1. POST /portal/login  — slug + username + password → challenge (MFA code)
 *   2. POST /portal/login/verify — challenge_id + code → resident JWT
 *
 * After a successful login the token is stored under `casa_portal_token` and
 * the user is redirected to /portal. The HTTP + token handling live in
 * lib/portal-live.ts; this component only drives the forms.
 */

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2, Lock } from "lucide-react";
import { ApiError } from "@/lib/api";
import { portalLogin, portalVerify, setPortalToken, portalCommunities } from "@/lib/portal-live";
import { Button, Card } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm " +
  "outline-none ring-offset-background placeholder:text-muted-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function LivePortalLogin() {
  const router = useRouter();

  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [communities, setCommunities] = useState<
    { id: string; name: string; slug: string; is_sandbox?: boolean }[]
  >([]);

  // Distinguishes "still loading" from "the server returned none" — an empty
  // dropdown with no explanation is impossible to diagnose from this screen.
  const [communitiesLoaded, setCommunitiesLoaded] = useState(false);

  useEffect(() => {
    portalCommunities()
      .then((data) => {
        setCommunities(data);
        if (data.length > 0) setSlug(data[0].slug);
      })
      .catch(console.error)
      .finally(() => setCommunitiesLoaded(true));
  }, []);

  // MFA step
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>("EMAIL");
  const [destination, setDestination] = useState("");
  const [otp, setOtp] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await portalLogin(slug, username, password);
      if (!res.mfa_required) {
        if (res.access_token) setPortalToken(res.access_token);
        router.replace("/portal");
      } else {
        setChallengeId(res.challenge_id ?? null);
        setChannel(res.channel ?? "EMAIL");
        setDestination(res.destination_masked ?? "");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await portalVerify(challengeId, otp);
      setPortalToken(res.access_token);
      router.replace("/portal");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
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
            <p className="text-xs text-muted-foreground">Sign in to your community account</p>
          </div>
        </div>

        <Card>
          {!challengeId ? (
            <form onSubmit={onLogin} className="flex flex-col gap-4">
              <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pl-slug" className="text-sm font-medium">
                  Community
                </label>
                <select
                  id="pl-slug"
                  required
                  className={fieldClass}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                >
                  <option value="" disabled>Select your community</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {/* Sandbox HOAs only ever reach this list outside
                          production; say so, so a tester knows which one. */}
                      {c.is_sandbox ? `${c.name} (sandbox)` : c.name}
                    </option>
                  ))}
                </select>
                {communitiesLoaded && communities.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No communities are available to sign in to yet. If this
                    deployment is for testing, its communities may be sandbox
                    ones — ask an administrator to set
                    {" "}
                    <code className="font-mono">
                      PORTAL_SHOW_SANDBOX_COMMUNITIES=true
                    </code>{" "}
                    on the API.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pl-username" className="text-sm font-medium">
                  Username
                </label>
                <input
                  id="pl-username"
                  type="text"
                  autoComplete="username"
                  required
                  className={fieldClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="jdoe"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pl-password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="pl-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={fieldClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

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
                    Signing in…
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <a
                href="/portal/forgot-password"
                className="text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot your password?
              </a>
            </form>
          ) : (
            <form onSubmit={onVerify} className="flex flex-col gap-4">
              <h1 className="text-xl font-semibold tracking-tight">Verify your identity</h1>
              <p className="text-sm text-muted-foreground">
                A one-time code was sent via{" "}
                <span className="font-semibold text-foreground">
                  {channel === "SMS" ? "text message" : "email"}
                </span>
                {destination && ` to ${destination}`}.
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pl-otp" className="text-sm font-medium">
                  One-time code
                </label>
                <input
                  id="pl-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  className={fieldClass}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="6-digit code"
                />
              </div>

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
                    Verifying…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setChallengeId(null);
                  setError(null);
                  setOtp("");
                }}
              >
                ← Back
              </button>
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
