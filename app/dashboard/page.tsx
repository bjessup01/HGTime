import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { requireUser, canEnterTimeNow } from "@/lib/auth";
import { openTimecard } from "@/lib/actions/timecard";
import {
  loadTimecard,
  loadEmployeeCodes,
  currentPayPeriod,
  recentPayPeriods,
} from "@/lib/timecard";
import { supabaseServer } from "@/lib/supabase";
import TimecardView from "@/components/timecard/timecard-view";
import { Panel } from "@/components/ui";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { period?: string; employee?: string };
}) {
  const user = await requireUser();
  const sb = supabaseServer();

  // Supervisors and admins can view another employee's card via ?employee=
  let targetId = user.id;
  let targetName: string | null = null;

  if (searchParams.employee && searchParams.employee !== user.id) {
    if (user.role === "employee") redirect("/dashboard");
    const { data: emp } = await sb
      .from("employee_current")
      .select("id, first_name, last_name")
      .eq("id", searchParams.employee)
      .maybeSingle();
    if (emp) {
      targetId = emp.id;
      targetName = `${emp.first_name} ${emp.last_name}`;
    }
  }

  const { data: target } = await sb
    .from("employee_current")
    .select("*")
    .eq("id", targetId)
    .maybeSingle();

  if (!target?.payroll_type) {
    return (
      <AppShell>
        <Panel title="No assignment">
          <p className="text-sm text-[var(--muted)]">
            This employee has no active assignment, so there is no pay period to
            show. A payroll admin can add one from the employee page.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const periods = await recentPayPeriods(target.payroll_type);
  const period = searchParams.period
    ? periods.find((p) => p.id === searchParams.period) ??
      (await currentPayPeriod(target.payroll_type))
    : await currentPayPeriod(target.payroll_type);

  if (!period) {
    return (
      <AppShell>
        <Panel title="No pay periods">
          <p className="text-sm text-[var(--muted)]">
            No pay periods exist for {target.payroll_type.replace("_", "-")}{" "}
            payroll yet.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const opened = await openTimecard(targetId, period.id);
  if (!opened.ok) {
    return (
      <AppShell>
        <Panel title="Could not open timecard">
          <p className="text-sm text-red-700">{opened.error}</p>
        </Panel>
      </AppShell>
    );
  }

  const [data, codes, entryPermission] = await Promise.all([
    loadTimecard(opened.timecardId),
    loadEmployeeCodes(targetId),
    canEnterTimeNow(targetId),
  ]);

  if (!data) {
    return (
      <AppShell>
        <Panel title="Timecard not found">
          <p className="text-sm text-[var(--muted)]">
            Something went wrong loading this card.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const isOwnCard = targetId === user.id;
  const isPrivileged =
    user.role === "supervisor" || user.role === "payroll_admin";

  return (
    <AppShell>
      <TimecardView
        data={data}
        codes={codes}
        periods={periods}
        currentPeriodId={period.id}
        isSalaried={target.employee_type === "salaried"}
        isOwnCard={isOwnCard}
        canEdit={entryPermission.allowed || isPrivileged}
        networkBlocked={!entryPermission.allowed && isOwnCard}
        viewingName={targetName}
        shuttleEligible={target.shuttle_eligible}
        scheduleCode={target.schedule_code}
      />
    </AppShell>
  );
}
