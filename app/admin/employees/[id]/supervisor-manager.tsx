"use client";

import { useState, useTransition } from "react";
import { addSupervisor, removeSupervisor } from "@/lib/actions/admin";
import { Panel, Button, selectClass, Empty } from "@/components/ui";

type Person = { id: string; name: string; number: string };

export default function SupervisorManager({
  employeeId,
  current,
  candidates,
}: {
  employeeId: string;
  current: Person[];
  candidates: Person[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  const currentIds = new Set(current.map((c) => c.id));
  const available = candidates.filter((c) => !currentIds.has(c.id));

  function onAdd() {
    if (!selected) return;
    const fd = new FormData();
    fd.set("employee_id", employeeId);
    fd.set("supervisor_id", selected);
    startTransition(async () => {
      const res = await addSupervisor(fd);
      setError(res.ok ? null : res.error);
      if (res.ok) setSelected("");
    });
  }

  return (
    <Panel
      title="Supervisors"
      description="Any assigned supervisor can approve this employee's timecard."
    >
      <div className="space-y-4">
        {current.length === 0 ? (
          <Empty>No supervisors assigned. Only payroll admins can approve this card.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {current.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5">
                <span className="text-sm">
                  {s.name} <span className="text-[var(--muted)]">#{s.number}</span>
                </span>
                <button
                  disabled={pending}
                  onClick={() =>
                    startTransition(() => { removeSupervisor(employeeId, s.id); })
                  }
                  className="text-sm text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className={selectClass + " max-w-sm flex-1"}
          >
            <option value="">Select an employee…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (#{c.number})
              </option>
            ))}
          </select>
          <Button onClick={onAdd} disabled={pending || !selected}>
            Add supervisor
          </Button>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </Panel>
  );
}
