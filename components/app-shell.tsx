import Link from "next/link";
import { requireUser, signOut } from "@/lib/auth";
import { Button } from "@/components/ui";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "payroll_admin";
  const isSupervisor = user.role === "supervisor" || isAdmin;

  const links = [
    { href: "/dashboard", label: "Home", show: true },
    { href: "/timecard", label: "My time", show: true },
    { href: "/approvals", label: "Approvals", show: isSupervisor },
    { href: "/admin/employees", label: "Employees", show: isAdmin },
    { href: "/admin/work-codes", label: "Work codes", show: isAdmin },
    { href: "/admin/pay-periods", label: "Pay periods", show: isAdmin },
    { href: "/admin/balances", label: "Balances", show: isAdmin },
    { href: "/admin/year-end", label: "Year end", show: isAdmin },
    { href: "/admin/audit", label: "Audit", show: isAdmin },
    { href: "/admin/networks", label: "Networks", show: isAdmin },
  ].filter((l) => l.show);

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <span className="font-semibold">Timekeeping</span>

          <nav className="flex flex-wrap gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-1.5 text-sm text-[var(--muted)] transition hover:bg-[var(--bg)] hover:text-[var(--ink)]"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-[var(--muted)]">
              {user.firstName} {user.lastName} · #{user.employeeNumber}
            </span>
            <form action={signOut}>
              <Button variant="secondary" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
