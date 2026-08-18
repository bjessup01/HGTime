import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Panel, Empty } from "@/components/ui";
import NewEmployeeForm from "./new-employee-form";
import EntryPeriodPicker from "./entry-period-picker";
import RosterTable from "./roster-table";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: { entryPeriod?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const entryPeriod = searchParams.entryPeriod;

  // deactivate logins for terminations whose date has arrived
  await sb.rpc("process_pending_terminations");

  const [
    { data: employees },
    { data: schedules },
    { data: workCodes },
    { data: periods },
  ] = await Promise.all([
    sb.from("employee_current").select("*").order("employee_number"),
    sb.from("work_schedules").select("code, name").eq("active", true).order("code"),
    sb.from("work_codes").select("code, description").eq("active", true).order("code"),
    sb
      .from("pay_periods")
      .select("id, start_date, end_date, payroll_type")
      .order("start_date", { ascending: false })
      .limit(40),
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

        <EntryPeriodPicker periods={periods ?? []} selected={entryPeriod} />

        <NewEmployeeForm
          schedules={schedules ?? []}
          workCodes={workCodes ?? []}
        />

        <Panel title="Roster">
          {!employees?.length ? (
            <Empty>No employees yet. Add the first one above.</Empty>
          ) : (
            <RosterTable employees={employees} entryPeriod={entryPeriod} />
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
