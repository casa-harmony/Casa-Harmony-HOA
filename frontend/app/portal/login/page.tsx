"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_BASE } from "@/lib/api";

export default function PortalLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ hoa_slug: "casa-harmony", username: "", password: "" });
  const [step, setStep] = useState<"creds" | "code" | "forgot" | "forgot_reset">("creds");
  const [challenge, setChallenge] = useState<{ id: string; channel: string; dest: string; dev?: string } | null>(null);
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/portal/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoa_slug: form.hoa_slug, username: form.username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Request failed");
      if (data.challenge_id) {
        setChallenge({ id: data.challenge_id, channel: data.channel, dest: data.destination_masked, dev: data.dev_otp });
        setStep("forgot_reset");
      } else {
        setNotice("If the account exists, a reset code was sent.");
        setStep("creds");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/portal/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_id: challenge.id, code, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Reset failed");
      setNotice("Password reset. Please sign in with your new password.");
      setStep("creds");
      setCode(""); setNewPw("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/portal/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Login failed");
      if (!data.mfa_required) {
        finish(data.access_token, data.resident);
        return;
      }
      setChallenge({ id: data.challenge_id, channel: data.channel, dest: data.destination_masked, dev: data.dev_otp });
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/portal/login/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_id: challenge.id, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Verification failed");
      finish(data.access_token, data.resident);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  function finish(token: string, resident: unknown) {
    localStorage.setItem("casa_portal_token", token);
    localStorage.setItem("casa_portal_resident", JSON.stringify(resident));
    router.push("/portal");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-center text-xl font-bold text-slate-800">Homeowner Portal</h1>
        <p className="mb-6 text-center text-sm text-slate-500">Casa Harmony AI</p>
        {notice && (
          <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        {step === "creds" && (
          <form onSubmit={submitCreds} className="space-y-3">
            <Field label="HOA" value={form.hoa_slug} onChange={(v) => setForm({ ...form, hoa_slug: v })} />
            <Field label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} autoFocus />
            <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            <Submit busy={busy} label="Continue" />
            <button type="button" onClick={() => { setStep("forgot"); setError(null); setNotice(null); }}
              className="w-full text-center text-xs text-brand-600 hover:underline">
              Forgot password?
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={submitCode} className="space-y-3">
            <p className="text-sm text-slate-600">
              We sent a 6-digit code by {challenge?.channel === "SMS" ? "text" : "email"} to{" "}
              <span className="font-medium">{challenge?.dest}</span>. Enter it below.
            </p>
            <Field label="Verification code" value={code} onChange={setCode} autoFocus />
            {challenge?.dev && (
              <p className="text-xs text-amber-600">Dev only — code: {challenge.dev}</p>
            )}
            <Submit busy={busy} label="Verify & sign in" />
            <button type="button" onClick={() => { setStep("creds"); setCode(""); }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600">← Back</button>
          </form>
        )}

        {step === "forgot" && (
          <form onSubmit={sendForgot} className="space-y-3">
            <p className="text-sm text-slate-600">Enter your HOA and username — we'll send a reset code.</p>
            <Field label="HOA" value={form.hoa_slug} onChange={(v) => setForm({ ...form, hoa_slug: v })} />
            <Field label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} autoFocus />
            <Submit busy={busy} label="Send reset code" />
            <button type="button" onClick={() => { setStep("creds"); setError(null); }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600">← Back</button>
          </form>
        )}

        {step === "forgot_reset" && (
          <form onSubmit={submitReset} className="space-y-3">
            <p className="text-sm text-slate-600">
              Enter the code sent to <span className="font-medium">{challenge?.dest}</span> and a new password.
            </p>
            <Field label="Verification code" value={code} onChange={setCode} autoFocus />
            {challenge?.dev && <p className="text-xs text-amber-600">Dev only — code: {challenge.dev}</p>}
            <Field label="New password" type="password" value={newPw} onChange={setNewPw} />
            <Submit busy={busy} label="Reset password" />
            <button type="button" onClick={() => { setStep("creds"); setCode(""); setNewPw(""); }}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-600">← Back</button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">
          Owners &amp; renters. Staff sign in <a href="/login" className="text-brand-600">here</a>.
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", autoFocus = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
    </div>
  );
}

function Submit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button type="submit" disabled={busy}
      className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
      {busy ? "Please wait…" : label}
    </button>
  );
}
