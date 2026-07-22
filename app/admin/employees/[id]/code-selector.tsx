"use client";

import { useState, useTransition } from "react";
import { setEmployeeWorkCodes, setEmployeeTimeOffCodes } from "@/lib/actions/admin";
import { Panel, Button } from "@/components/ui";

type Code = { id: string; code: string; description: string };

export default function CodeSelector({
  employeeId,
  workCodes,
  selectedWorkCodes,
  timeOffCodes,
  selectedTimeOffCodes,
}: {
  employeeId: string;
  workCodes: Code[];
  selectedWorkCodes: string[];
  timeOffCodes: Code[];
  selectedTimeOffCodes: string[];
}) {
  return (
    <>
      <CodeList
        title="Usable work codes"
        description="Codes this employee can select when entering time. The default code is always included."
        employeeId={employeeId}
        codes={workCodes}
        selected={selectedWorkCodes}
        save={setEmployeeWorkCodes}
      />
      <CodeList
        title="Allowed time-off codes"
        description="Codes this employee can use for time off. Admin-only codes stay hidden from employees regardless."
        employeeId={employeeId}
        codes={timeOffCodes}
        selected={selectedTimeOffCodes}
        save={setEmployeeTimeOffCodes}
      />
    </>
  );
}

function CodeList({
  title,
  description,
  employeeId,
  codes,
  selected,
  save,
}: {
  title: string;
  description: string;
  employeeId: string;
  codes: Code[];
  selected: string[];
  save: (employeeId: string, ids: string[]) => Promise<any>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggle(id: string) {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
    setSaved(false);
  }

  function onSave() {
    startTransition(async () => {
      await save(employeeId, Array.from(picked));
      setSaved(true);
    });
  }

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {codes.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">None defined yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {codes.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--line)] p-3 text-sm hover:bg-[var(--bg)]"
            >
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={() => toggle(c.id)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-mono text-xs font-semibold">{c.code}</span>
                <span className="block text-xs text-[var(--muted)]">{c.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Panel>
  );
}
