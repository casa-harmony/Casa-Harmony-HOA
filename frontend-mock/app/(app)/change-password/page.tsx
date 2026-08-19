"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import { Alert, Button, Card, Input, Label, PasswordInput } from "@/components/ui";

export default function ChangePasswordPage() {
  const { token, user, clearMustChange } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.new_password !== form.confirm) {
      setError("New password and confirmation do not match");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST", token,
        body: { current_password: form.current_password, new_password: form.new_password },
      });
      clearMustChange();
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Change Password</h1>
        <p className="text-sm text-slate-500">
          {user?.mustChangePassword
            ? "Please set a new password before continuing."
            : "Update your account password."}
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Current password</Label>
            <PasswordInput type="password" autoComplete="current-password" value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })} required />
          </div>
          <div>
            <Label>New password (min 8 chars)</Label>
            <PasswordInput type="password" autoComplete="new-password" value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })} required minLength={8} />
          </div>
          <div>
            <Label>Confirm new password</Label>
            <PasswordInput type="password" autoComplete="new-password" value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })} required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
