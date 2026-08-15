"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { ApiError, isLive } from "@/lib/api";
import { portalAcceptInvite } from "@/lib/portal-live";
import { Button, Card } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm " +
  "outline-none ring-offset-background placeholder:text-muted-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") || "";
  const [form, setForm] = useState({ new_password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.new_password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (form.new_password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await portalAcceptInvite(token, form.new_password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not activate your account. The link may be invalid or already used."
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        <div>
          <p className="text-lg font-semibold tracking-tight">
            Your password is set
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can now sign in to the resident portal.
          </p>
        </div>
        <Button className="mt-2 w-full" onClick={() => router.replace("/portal/login")}>
          Go to sign in
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          This invite link is missing its token. Check the link in your email,
          or contact your community manager for a new one.
        </p>
        <Button variant="outline" className="mt-2 w-full" onClick={() => router.replace("/portal/login")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Set your password</h1>
      <p className="text-sm text-muted-foreground">
        Welcome! Choose a password to activate your resident account. It must be
        at least 8 characters.
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
        <label htmlFor="ai-password" className="text-sm font-medium">
          New password
        </label>
        <input
          id="ai-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={fieldClass}
          value={form.new_password}
          onChange={(e) => setForm({ ...form, new_password: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ai-confirm" className="text-sm font-medium">
          Confirm password
        </label>
        <input
          id="ai-confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={fieldClass}
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
      </div>

      <Button type="submit" disabled={busy} className="mt-1 w-full">
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Activating…
          </>
        ) : (
          "Set password"
        )}
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  if (!isLive) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-6 text-center text-sm text-muted-foreground">
          Resident invitations are a live-backend feature. Run the app in live
          mode to set a resident&apos;s password from their invite link.
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
            <p className="text-xs text-muted-foreground">Activate your account</p>
          </div>
        </div>
        <Card>
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
            <AcceptInviteForm />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
