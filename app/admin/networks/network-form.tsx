"use client";

import { useState, useTransition } from "react";
import { addAllowedNetwork } from "@/lib/actions/admin";
import { Panel, Field, Button, inputClass } from "@/components/ui";

export default function NetworkForm({ currentIp }: { currentIp: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(null);
  const [cidr, setCidr] = useState("");

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await addAllowedNetwork(formData);
      if (res.ok) {
        setMessage({ ok: res.message });
        setCidr("");
      } else {
        setMessage({ error: res.error });
      }
    });
  }

  return (
    <Panel title="Add network">
      <form action={onSubmit} className="flex flex-wrap items-end gap-4">
        <div className="min-w-[14rem] flex-1">
          <Field label="Location">
            <input name="location" required placeholder="Four Lakes office" className={inputClass} />
          </Field>
        </div>
        <div className="w-64">
          <Field label="IP address or range" hint="A single address becomes a /32">
            <input
              name="cidr"
              required
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder="203.0.113.14 or 203.0.113.0/24"
              className={inputClass + " font-mono text-sm"}
            />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        {currentIp && (
          <Button type="button" variant="secondary" onClick={() => setCidr(currentIp)}>
            Use my IP
          </Button>
        )}
      </form>

      {message?.ok && <p className="mt-3 text-sm text-emerald-700">{message.ok}</p>}
      {message?.error && <p className="mt-3 text-sm text-red-700">{message.error}</p>}
    </Panel>
  );
}
