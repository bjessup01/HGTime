"use client";

import { useState, useTransition } from "react";
import { createWorkCode } from "@/lib/actions/admin";
import { Panel, Field, Button, inputClass } from "@/components/ui";

export default function WorkCodeForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(null);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createWorkCode(formData);
      setMessage(res.ok ? { ok: res.message } : { error: res.error });
    });
  }

  return (
    <Panel title="Add work code">
      <form action={onSubmit} className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <Field label="Code">
            <input
              name="code"
              required
              placeholder="WHPEDAV"
              className={inputClass + " font-mono uppercase"}
            />
          </Field>
        </div>
        <div className="min-w-[16rem] flex-1">
          <Field label="Description">
            <input name="description" required className={inputClass} />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </form>

      {message?.ok && <p className="mt-3 text-sm text-emerald-700">{message.ok}</p>}
      {message?.error && <p className="mt-3 text-sm text-red-700">{message.error}</p>}
    </Panel>
  );
}
