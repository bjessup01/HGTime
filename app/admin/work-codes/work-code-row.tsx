"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWorkCode, toggleWorkCode } from "@/lib/actions/admin";
import { Badge, Button, inputClass } from "@/components/ui";

export default function WorkCodeRow({ code }: { code: any }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSave(formData: FormData) {
    startTransition(async () => {
      const res = await updateWorkCode(formData);
      if (res.ok) {
        setEditing(false);
        setError(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-[var(--line)] last:border-0">
        <td colSpan={4} className="py-3">
          <form action={onSave} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={code.id} />
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium">Code</label>
              <input
                name="code"
                defaultValue={code.code}
                required
                className={inputClass + " font-mono uppercase"}
              />
            </div>
            <div className="min-w-[16rem] flex-1">
              <label className="mb-1 block text-xs font-medium">Description</label>
              <input
                name="description"
                defaultValue={code.description}
                required
                className={inputClass}
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            {error && <p className="w-full text-sm text-red-700">{error}</p>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-[var(--line)] last:border-0">
      <td className="py-3 pr-4 font-mono text-xs font-semibold">{code.code}</td>
      <td className="py-3 pr-4">{code.description}</td>
      <td className="py-3 pr-4">
        {code.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}
      </td>
      <td className="py-3">
        <div className="flex gap-3">
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Edit
          </button>
          <button
            disabled={pending}
            onClick={() =>
              startTransition(() => {
                toggleWorkCode(code.id, !code.active);
                router.refresh();
              })
            }
            className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            {code.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </td>
    </tr>
  );
}
