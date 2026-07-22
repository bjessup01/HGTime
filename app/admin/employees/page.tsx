import Link from "next/link";
import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Panel, Table, Badge, Empty } from "@/components/ui";
import NewEmployeeForm from "./new-employee-form";

const TYPE_LABEL: Record<string, string> = {
  salaried: "Salaried",
  full_time_hourly: "Full-time hourly",
  part_time: "Part-time",
  on_call: "On-call",
  seasonal: "Seasonal",
};

const PAYROLL_LABEL: Record<string, string> = {
  semi_monthly: "Semi-monthly",
  bi_weekly: "Bi-weekly",
};

export default async function EmployeesPage() {
  await requireAdmin();
  const sb = supabaseServer();

  const [{ data: employees }, { data: schedules }, { data: workCodes }] =
    await Promise.all([
      sb.from("employee_current").select("*").order("employee_number"),
      sb.from("work_schedules").select("code, name").eq("active", true).order("code"),
      sb.from("work_codes").select("code, description").eq("active", true).order("code"),
    ]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {employees?.length ?? 0} on file
          </p>
        </div>

        <NewEmployeeForm
          schedules={schedules ?? []}
          workCodes={workCodes ?? []}
        />

        <Panel title="Roster">
          {!employees?.length ? (
            <Empty>No employees yet. Add the first one above.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th className="py-2 pr-4 font-medium">#</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Payroll</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Schedule</th>
                  <th className="py-2 pr-4 font-medium">Default code</th>
                  <th className="py-2 pr-4 font-medium">Flags</th>
                  <th className="py-2 font-medium"></th>
                </>
              }
            >
              {employees.map((e: any) => (
                <tr key={e.id} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-3 pr-4 font-mono text-xs">{e.employee_number}</td>
                  <td className="py-3 pr-4">
                    {e.first_name} {e.last_name}
                    {e.role !== "employee" && (
                      <span className="ml-2">
                        <Badge tone="neutral">
                          {e.role === "payroll_admin" ? "Payroll admin" : "Supervisor"}
                        </Badge>
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">{PAYROLL_LABEL[e.payroll_type] ?? "—"}</td>
                  <td className="py-3 pr-4">{TYPE_LABEL[e.employee_type] ?? "—"}</td>
                  <td className="py-3 pr-4">{e.schedule_code ?? "—"}</td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {e.default_work_code ?? "—"}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {e.holiday_eligible && <Badge tone="good">Holiday</Badge>}
                      {e.shuttle_eligible && <Badge tone="neutral">Shuttle</Badge>}
                      {e.can_enter_remotely && <Badge tone="warn">Remote</Badge>}
                      {!e.currently_employed && <Badge tone="bad">Termed</Badge>}
                    </div>
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/admin/employees/${e.id}`}
                      className="text-sm text-[var(--accent)] hover:underline"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
