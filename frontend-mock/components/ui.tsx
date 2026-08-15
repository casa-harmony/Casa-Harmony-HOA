"use client";

/**
 * Shared primitives used across every page.
 *
 * The public API is unchanged from the original file so existing pages keep
 * working, but everything is now driven by the design tokens in globals.css —
 * which means light/dark mode comes for free and the palette is consistent.
 */

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ Button */

type Variant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "outline"
  | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary",
  secondary:
    "bg-card text-foreground border border-border shadow-sm hover:bg-muted",
  outline:
    "bg-transparent text-foreground border border-border hover:bg-muted",
  subtle: "bg-muted text-foreground hover:bg-muted/70",
  danger:
    "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-10 px-5 text-sm gap-2",
  icon: "h-9 w-9 p-0",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm",
        padded && "p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ Form fields */

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
      className={cn(
        "mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {children}
    </label>
  );
}

const fieldBase =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors " +
  "placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/20 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(fieldBase, "min-h-[80px] resize-y", className)}
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
    <select className={cn(fieldBase, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------- Badge */

/**
 * `tone` accepts semantic names plus the legacy COA qualifier codes that
 * existing pages already pass in.
 */
const badgeTones: Record<string, string> = {
  // semantic
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-destructive/12 text-destructive border-destructive/30",
  info: "bg-info/12 text-info border-info/30",
  primary: "bg-primary/12 text-primary border-primary/30",
  brass: "bg-brass/12 text-brass border-brass/30",
  neutral: "bg-muted text-muted-foreground border-border",
  // legacy COA qualifiers
  balancing: "bg-warning/12 text-warning border-warning/30",
  natural_account: "bg-success/12 text-success border-success/30",
  cost_center: "bg-info/12 text-info border-info/30",
  fund: "bg-primary/12 text-primary border-primary/30",
  intercompany: "bg-destructive/12 text-destructive border-destructive/30",
  management: "bg-brass/12 text-brass border-brass/30",
  secondary_tracking: "bg-primary/12 text-primary border-primary/30",
  none: "bg-muted text-muted-foreground border-border",
  A: "bg-success/12 text-success border-success/30",
  L: "bg-destructive/12 text-destructive border-destructive/30",
  O: "bg-primary/12 text-primary border-primary/30",
  R: "bg-info/12 text-info border-info/30",
  E: "bg-warning/12 text-warning border-warning/30",
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
  const color = (tone && badgeTones[tone]) || badgeTones.neutral;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs font-semibold",
        color,
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Modal */

import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  }[size];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "w-full animate-fade-in rounded-xl border bg-card shadow-2xl",
          widths
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto p-5 scroll-thin">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t bg-muted/40 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------- Alert */

export function Alert({
  kind = "error",
  title,
  children,
}: {
  kind?: "error" | "success" | "info" | "warning";
  title?: string;
  children: React.ReactNode;
}) {
  const styles = {
    error: "bg-destructive/8 text-destructive border-destructive/30",
    success: "bg-success/8 text-success border-success/30",
    info: "bg-info/8 text-info border-info/30",
    warning: "bg-warning/8 text-warning border-warning/30",
  }[kind];
  return (
    <div className={cn("rounded-lg border px-4 py-2.5 text-sm", styles)}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- Spinner */

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
      {label}
    </div>
  );
}

/* --------------------------------------------------------------- Skeleton */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/* -------------------------------------------------------------- Separator */

export function Separator({
  className = "",
  orientation = "horizontal",
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      role="separator"
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
    />
  );
}

/* ----------------------------------------------------------------- Avatar */

export function Avatar({
  name,
  className = "",
  tone = "primary",
}: {
  name: string;
  className?: string;
  tone?: "primary" | "brass" | "muted";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const tones = {
    primary: "bg-primary/15 text-primary",
    brass: "bg-brass/15 text-brass",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        tones,
        className
      )}
    >
      {initials}
    </span>
  );
}

/* ----------------------------------------------------------------- Switch */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-card shadow transition-transform",
          checked ? "translate-x-[1.125rem]" : "translate-x-[0.1875rem]"
        )}
      />
    </button>
  );
}
