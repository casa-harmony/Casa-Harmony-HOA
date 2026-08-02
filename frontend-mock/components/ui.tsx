"use client";

import React from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500",
  secondary:
    "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-brand-500",
  danger: "bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500",
  ghost: "text-slate-600 hover:bg-slate-100 focus:ring-slate-400",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Label({
  children,
  htmlFor,
  className = "",
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </label>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${className}`}
      {...props}
    />
  );
});

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

const badgeColors: Record<string, string> = {
  balancing: "bg-amber-100 text-amber-800",
  natural_account: "bg-emerald-100 text-emerald-800",
  cost_center: "bg-sky-100 text-sky-800",
  fund: "bg-violet-100 text-violet-800",
  intercompany: "bg-pink-100 text-pink-800",
  management: "bg-indigo-100 text-indigo-800",
  secondary_tracking: "bg-teal-100 text-teal-800",
  none: "bg-slate-100 text-slate-600",
  A: "bg-emerald-100 text-emerald-800",
  L: "bg-rose-100 text-rose-800",
  O: "bg-indigo-100 text-indigo-800",
  R: "bg-sky-100 text-sky-800",
  E: "bg-amber-100 text-amber-800",
};

export function Badge({
  children,
  tone,
  className = "",
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  const color = (tone && badgeColors[tone]) || "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color} ${className}`}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const styles = {
    error: "bg-rose-50 text-rose-700 border-rose-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
  }[kind];
  return (
    <div className={`rounded-lg border px-4 py-2 text-sm ${styles}`}>{children}</div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      Loading…
    </div>
  );
}
