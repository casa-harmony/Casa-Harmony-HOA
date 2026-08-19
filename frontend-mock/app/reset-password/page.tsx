"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { PasswordInput } from "@/components/ui";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") || "";
  const [form, setForm] = useState({ new_password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.new_password !== form.confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: form.new_password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Reset failed");
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p className="text-sm text-rose-600">Missing or invalid reset link.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <PasswordInput type="password" placeholder="New password (min 8)" minLength={8} required
        value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <PasswordInput type="password" placeholder="Confirm new password" minLength={8} required
        value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" disabled={busy}
        className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-6 text-center text-xl font-bold text-slate-800">Set a new password</h1>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
