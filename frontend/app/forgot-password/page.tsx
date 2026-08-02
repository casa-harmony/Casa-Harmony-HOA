"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setSent(true);
      // Development convenience: backend returns the reset token when no mailer.
      if (data.dev_reset_token) setDevLink(`/reset-password?token=${data.dev_reset_token}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-center text-xl font-bold text-slate-800">Reset your password</h1>
        <p className="mb-6 text-center text-sm text-slate-500">Staff accounts</p>
        {sent ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>If that email is on file, a reset link has been sent. Check your inbox.</p>
            {devLink && (
              <p className="text-xs text-amber-600">
                Dev only: <a className="underline" href={devLink}>open reset link</a>
              </p>
            )}
            <a href="/login" className="block text-center text-brand-600">← Back to sign in</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={busy}
              className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <a href="/login" className="block text-center text-xs text-slate-400 hover:text-slate-600">← Back to sign in</a>
          </form>
        )}
      </div>
    </div>
  );
}
