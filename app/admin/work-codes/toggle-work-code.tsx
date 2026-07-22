"use client";

import { useTransition } from "react";
import { toggleWorkCode } from "@/lib/actions/admin";

export default function ToggleWorkCode({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => { toggleWorkCode(id, !active); })}
      className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
    >
      {active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
