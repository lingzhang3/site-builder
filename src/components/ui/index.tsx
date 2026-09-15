"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * A small set of primitives rather than a component library. The app needs
 * about six shapes; hand-rolling them keeps the dependency surface (and the
 * bundle) small and means every one reads the theme tokens from globals.css.
 */

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-border hover:bg-surface-muted",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-surface-muted hover:text-ink",
  danger: "bg-transparent text-danger border-border hover:bg-danger-soft",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-medium whitespace-nowrap",
        "transition-colors disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

const FIELD_BASE =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-subtle disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, "h-9", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(FIELD_BASE, "h-9", className)} {...props} />;
  },
);

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && !error ? <span className="block text-xs text-ink-subtle">{hint}</span> : null}
      {error ? (
        <span className="block text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Containers and feedback                                                    */
/* -------------------------------------------------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-[--radius-card] border border-border bg-surface", className)}>
      {children}
    </div>
  );
}

export function Alert({
  tone = "danger",
  title,
  children,
}: {
  tone?: "danger" | "warning" | "success" | "info";
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    danger: "border-danger/30 bg-danger-soft text-danger",
    warning: "border-warning/30 bg-warning-soft text-ink",
    success: "border-success/30 bg-success-soft text-ink",
    info: "border-border bg-surface-muted text-ink-muted",
  } as const;

  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone])} role="status">
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && "mt-0.5", "text-sm")}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[--radius-card] border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-border border-t-accent",
        className,
      )}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-muted text-ink-muted",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-ink",
    danger: "bg-danger-soft text-danger",
  } as const;

  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
