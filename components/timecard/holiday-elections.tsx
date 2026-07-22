"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHolidayElection } from "@/lib/actions/timecard";
import { Panel, Button, Badge } from "@/components/ui";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmt(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${DAY_NAMES[d.getDay()]}, ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function HolidayElections({
  timecardId,
  summary,
  conversions,
  isSalaried,
  editable,
}: any) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const worked = summary.filter((h: any) => h.worked_hours > 0);
  const converting = conversions.filter((c: any) => c.converts);

  if (worked.length === 0 && converting.length === 0) return null;

  function choose(workDate: string, election: "floating_holiday" | "double_time") {
    startTransition(async () => {
      const res = await setHolidayElection(timecardId, workDate, election);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <Panel
      title="Holiday"
      description="Hours worked on a holiday reduce holiday pay hour for hour."
    >
      <div className="space-y-4">
        {worked.map((h: any) => (
          <div
            key={h.work_date}
            className="rounded-lg border border-[var(--line)] p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-medium">{h.holiday_name}</p>
                <p className="text-sm text-[var(--muted)]">{fmt(h.work_date)}</p>
              </div>
              <div className="text-right text-sm">
                <p>
                  Worked <span className="font-medium tabular-nums">{Number(h.worked_hours)}h</span>
                </p>
                <p className="text-[var(--muted)]">
                  Holiday pay remaining:{" "}
                  <span className="tabular-nums">{Number(h.remaining_holiday)}h</span>
                </p>
              </div>
            </div>

            {isSalaried ? (
              <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {Number(h.worked_hours)} floating holiday hours will be added to your
                balance.
              </p>
            ) : h.election ? (
              <div className="mt-3 flex items-center gap-3">
                <Badge tone="good">
                  {h.election === "floating_holiday" ? "Floating holiday" : "Double time"}
                </Badge>
                {editable && (
                  <button
                    onClick={() =>
                      choose(
                        h.work_date,
                        h.election === "floating_holiday"
                          ? "double_time"
                          : "floating_holiday"
                      )
                    }
                    disabled={pending}
                    className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
                  >
                    Change to{" "}
                    {h.election === "floating_holiday" ? "double time" : "floating holiday"}
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-sm">
                  You worked on this holiday. Choose how you want those{" "}
                  {Number(h.worked_hours)} hours handled:
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => choose(h.work_date, "floating_holiday")}
                    disabled={pending || !editable}
                  >
                    Floating holiday
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => choose(h.work_date, "double_time")}
                    disabled={pending || !editable}
                  >
                    Double time
                  </Button>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Floating holiday banks {Number(h.worked_hours)} hours to use later.
                  Double time pays those hours at twice the rate. Your choice is noted
                  on the timecard for payroll.
                </p>
              </div>
            )}
          </div>
        ))}

        {converting.map((c: any) => (
          <div
            key={c.week_start}
            className="rounded-lg border border-blue-200 bg-blue-50 p-4"
          >
            <p className="text-sm font-medium text-blue-900">
              {c.holiday_name} converts to a floating holiday
            </p>
            <p className="mt-1 text-sm text-blue-800">
              You worked {c.days_worked} days this week, so the{" "}
              {Number(c.holiday_hours)} holiday hours are banked as a floating holiday
              instead of paid out. This keeps the week at 40 hours rather than
              generating overtime you did not work.
            </p>
          </div>
        ))}

        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </Panel>
  );
}
