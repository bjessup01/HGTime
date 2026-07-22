import { ReactNode } from "react";

export function Panel({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-sm">
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
            )}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

// Inputs are deliberately large — shared terminals, gloved hands, phones.
export const inputClass =
  "w-full rounded-md border border-[var(--line)] bg-white px-3 py-2.5 text-base " +
  "outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

export const selectClass = inputClass + " appearance-none";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const styles = {
    primary: "bg-[var(--accent)] text-white hover:brightness-110",
    secondary:
      "bg-white text-[var(--ink)] border border-[var(--line)] hover:bg-[var(--bg)]",
    danger: "bg-red-600 text-white hover:brightness-110",
  }[variant];

  return (
    <button
      {...props}
      className={`rounded-md px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const styles = {
    neutral: "bg-slate-100 text-slate-700",
    good: "bg-emerald-100 text-emerald-800",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-100 text-red-800",
  }[tone];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-[var(--muted)]">{children}</p>
  );
}
