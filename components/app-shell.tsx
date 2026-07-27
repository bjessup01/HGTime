import { requireUser, signOut } from "@/lib/auth";
import { Button } from "@/components/ui";
import Nav from "@/components/nav";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "payroll_admin";
  const isSupervisor = user.role === "supervisor" || isAdmin;

  // Frequently used destinations stay flat; configuration and reports
  // group into menus so the bar does not keep growing.
  const links = [
    { href: "/dashboard", label: "Home", show: true },
    { href: "/timecard", label: "My time", show: true },
    { href: "/approvals", label: "Approvals", show: isSupervisor },
    { href: "/admin/employees", label: "Employees", show: isAdmin },
    { href: "/admin/balances", label: "Balances", show: isAdmin },
  ].filter((l) => l.show);

  const groups = [
    {
      label: "Reports",
      show: isAdmin,
      links: [
        { href: "/admin/year-end", label: "Year end" },
        { href: "/admin/overtime-report", label: "Overtime" },
        { href: "/admin/time-off-report", label: "Time off" },
        { href: "/admin/shuttle-report", label: "Shuttle" },
        { href: "/admin/missing-timecards", label: "Missing timecards" },
        { href: "/admin/audit", label: "Audit" },
      ],
    },
    {
      label: "Settings",
      show: isAdmin,
      links: [
        { href: "/admin/work-codes", label: "Work codes" },
        { href: "/admin/pay-periods", label: "Pay periods" },
        { href: "/admin/networks", label: "Networks" },
      ],
    },
  ].filter((g) => g.show);

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <span className="font-semibold">Timekeeping</span>

          <Nav links={links} groups={groups} />

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
