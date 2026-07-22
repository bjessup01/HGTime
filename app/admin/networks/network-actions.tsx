"use client";

import { useTransition } from "react";
import { toggleNetwork, deleteNetwork } from "@/lib/actions/admin";

export default function NetworkActions({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-3">
      <button
        disabled={pending}
        onClick={() => startTransition(() => { toggleNetwork(id, !active); })}
        className="text-sm text-[var(--accent)] hover:underline disabled:opacity-50"
      >
        {active ? "Disable" : "Enable"}
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm("Remove this network from the allowlist?")) {
            startTransition(() => { deleteNetwork(id); });
          }
        }}
        className="text-sm text-red-600 hover:underline disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}
