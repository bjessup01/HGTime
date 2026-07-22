import Link from "next/link";
import AppShell from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Panel, Badge, Button } from "@/components/ui";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function daysUntil(iso: string) {
  const target = new Date(iso + "T00:00:00").getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / 86400000);
}

export default async function DashboardPage() {
  const user = await requireUser();
  const sb = supabaseServer();

  const [{ data: dash }, { data: yearEnd }] = await Promise.all([
    sb.rpc("employee_dashboard", { p_employee_id: user.id }),
    sb.rpc("year_end_projection", { p_employee_id: user.id }),
  ]);

  const d = (dash as any[])?.[0] ?? null;
  const ye = (yearEnd as any[])?.[0] ?? null;

  const hasBalances =
    d && (Number(d.vacation_balance) > 0 || Number(d.sick_balance) > 0);

  const vacationAtRisk = ye ? Number(ye.vacation_to_use) : 0;
  const daysToYearEnd = ye ? daysUntil(ye.fiscal_year_end) : null;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">
            Welcome, {user.firstName}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            #{user.employeeNumber}
            {user.employeeType && ` · ${user.employeeType.replace(/_/g, " ")}`}
            {user.scheduleCode && ` · ${user.scheduleCode}`}
            {user.payrollType &&
              ` · ${user.payrollType === "semi_monthly" ? "semi-monthly" : "bi-weekly"}`}
          </p>
        </div>

        {/* Current timecard */}
        <Panel title="Current pay period">
          {d?.open_period_start ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm">
                  {fmtDate(d.open_period_start)} – {fmtDate(d.open_period_end)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.open_timecard_status} />
                  {Number(d.pending_warnings) > 0 && (
                    <Badge tone="warn">
                      {d.pending_warnings} item
                      {Number(d.pending_warnings) === 1 ? "" : "s"} need attention
                    </Badge>
                  )}
                </div>
              </div>
              <Link href="/timecard">
                <Button>Enter my time</Button>
              </Link>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No open pay period right now.
            </p>
          )}
        </Panel>

        {/* Balances */}
        <div className="grid gap-6 md:grid-cols-3">
          <BalanceCard
            label="Vacation"
            balance={Number(d?.vacation_balance ?? 0)}
            asOf={d?.vacation_as_of}
            pending={Number(d?.vacation_pending ?? 0)}
          />
          <BalanceCard
            label="Sick"
            balance={Number(d?.sick_balance ?? 0)}
            asOf={d?.sick_as_of}
            pending={Number(d?.sick_pending ?? 0)}
          />
          <Panel title="Floating holiday">
            <p className="text-3xl font-semibold tabular-nums">
              {Number(d?.floating_holiday ?? 0)}
              <span className="ml-1 text-base font-normal text-[var(--muted)]">
                hours
              </span>
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Earned by working a holiday. Use under the Holiday code.
            </p>
          </Panel>
        </div>

        {!hasBalances && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-4">
            <p className="text-sm text-[var(--muted)]">
              No balances on file yet. Vacation and sick balances are imported from
              payroll after each run — check back once your first import lands.
            </p>
          </div>
        )}

        {/* Year-end projection */}
        {ye && hasBalances && (
          <Panel
            title={`Before fiscal year end (${fmtDate(ye.fiscal_year_end)})`}
            description={
              daysToYearEnd !== null && daysToYearEnd > 0
                ? `${daysToYearEnd} days away`
                : undefined
            }
          >
            {vacationAtRisk > 0 ? (
              <div className="space-y-4">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900">
                    You have {vacationAtRisk} vacation hours above the{" "}
                    {Number(ye.vacation_cap)} hour carryover limit
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    {Number(ye.vacation_to_sick) > 0 && Number(ye.vacation_forfeited) > 0 ? (
                      <>
                        If unused, {Number(ye.vacation_to_sick)}h will convert to sick
                        time and {Number(ye.vacation_forfeited)}h will be forfeited.
                      </>
                    ) : Number(ye.vacation_to_sick) > 0 ? (
                      <>
                        If unused, these will convert to sick time at the end of{" "}
                        {fmtDate(ye.fiscal_year_end)}.
                      </>
                    ) : (
                      <>
                        Your sick bank is already at its {Number(ye.sick_cap)} hour
                        limit, so unused hours will be forfeited.
                      </>
                    )}
                  </p>
                </div>

                <ProjectionDetail ye={ye} />
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-emerald-700">
                  Your vacation balance is within the {Number(ye.vacation_cap)} hour
                  carryover limit. Nothing will be lost.
                </p>
                {Number(ye.sick_to_vacation) > 0 && <ProjectionDetail ye={ye} />}
              </div>
            )}
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

function BalanceCard({
  label,
  balance,
  asOf,
  pending,
}: {
  label: string;
  balance: number;
  asOf: string | null;
  pending: number;
}) {
  const available = Math.max(balance - pending, 0);

  return (
    <Panel title={label}>
      <p className="text-3xl font-semibold tabular-nums">
        {available}
        <span className="ml-1 text-base font-normal text-[var(--muted)]">hours</span>
      </p>

      {pending > 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          {balance} on file, less {pending}h entered since
        </p>
      )}

      <p className="mt-2 text-xs text-[var(--muted)]">
        As of {fmtDate(asOf)}
      </p>
    </Panel>
  );
}

/** The two-step conversion, shown so the employee can see the arithmetic. */
function ProjectionDetail({ ye }: { ye: any }) {
  const step1 = Number(ye.vacation_over) > 0;
  const step2 = Number(ye.sick_over) > 0;

  if (!step1 && !step2) return null;

  return (
    <div className="rounded-md border border-[var(--line)] p-4 text-sm">
      <p className="mb-3 font-medium">What happens if nothing changes</p>

      <dl className="space-y-2">
        <Line
          label={`Projected balance on ${fmtDate(ye.fiscal_year_end)}`}
          value={`${Number(ye.projected_vacation)}h vacation · ${Number(
            ye.projected_sick
          )}h sick`}
        />

        {step1 && (
          <>
            {Number(ye.vacation_to_sick) > 0 && (
              <Line
                label="Vacation over the limit moves to sick (1:1)"
                value={`${Number(ye.vacation_to_sick)}h`}
              />
            )}
            {Number(ye.vacation_forfeited) > 0 && (
              <Line
                label="Vacation forfeited (sick bank full)"
                value={`${Number(ye.vacation_forfeited)}h`}
                tone="bad"
              />
            )}
          </>
        )}

        {step2 && (
          <Line
            label="Sick over the limit converts to vacation (3:1)"
            value={`${Number(ye.sick_consumed)}h sick → ${Number(
              ye.sick_to_vacation
            )}h vacation`}
          />
        )}

        <div className="border-t border-[var(--line)] pt-2">
          <Line
            label="Starting balance on April 1"
            value={`${Number(ye.final_vacation)}h vacation · ${Number(
              ye.final_sick
            )}h sick`}
            bold
          />
        </div>
      </dl>

      <p className="mt-3 text-xs text-[var(--muted)]">
        This is an estimate based on your current balance and any time off already
        entered. Payroll confirms the final numbers.
      </p>
    </div>
  );
}

function Line({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "bad";
}) {
  return (
    <div className={`flex flex-wrap justify-between gap-2 ${bold ? "font-semibold" : ""}`}>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className={`tabular-nums ${tone === "bad" ? "text-red-700" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; tone: any }> = {
    open: { label: "Open", tone: "neutral" },
    employee_approved: { label: "You approved", tone: "warn" },
    supervisor_approved: { label: "Supervisor approved", tone: "good" },
    exported: { label: "Exported", tone: "good" },
  };
  const s = map[status ?? "open"] ?? map.open;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
