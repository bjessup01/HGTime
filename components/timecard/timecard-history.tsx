"use client";

import { useState } from "react";
import { Panel, Badge, Empty } from "@/components/ui";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function fmtDay(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TimecardHistory({ history, isOwnCard }: any) {
  const [open, setOpen] = useState(false);

  if (!history?.length) return null;

  // Changes made by someone else are the ones an employee cares about.
  const byOthers = isOwnCard
    ? history.filter((h: any) => h.actor_number && !h.is_system)
    : [];

  const shown = open ? history : history.slice(0, 5);

  return (
    <Panel
      title="Change history"
      description={
        byOthers.length > 0
          ? `${byOthers.length} change${
              byOthers.length === 1 ? "" : "s"
            } to this card`
          : undefined
      }
      actions={
        history.length > 5 ? (
          <button
            onClick={() => setOpen(!open)}
            className="text-sm text-[var(--accent)] hover:underline"
          >
            {open ? "Show less" : `Show all ${history.length}`}
          </button>
        ) : undefined
      }
    >
      <ul className="space-y-2">
        {shown.map((h: any, i: number) => (
          <li
            key={i}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[var(--line)] pb-2 text-sm last:border-0 last:pb-0"
          >
            <span className="text-[var(--muted)]">{fmtWhen(h.logged_at)}</span>
            <span className="font-medium">{h.actor_name}</span>

            {h.action === "insert" && <span>added</span>}
            {h.action === "update" && <span>changed</span>}
            {h.action === "delete" && <span>removed</span>}

            {h.work_date && (
              <span className="whitespace-nowrap">{fmtDay(h.work_date)}</span>
            )}

            <span className="font-mono text-xs">{h.description}</span>

            {h.action === "update" && h.was && h.now_is && (
              <span className="text-[var(--muted)]">
                {h.was} → <span className="text-[var(--ink)]">{h.now_is}</span>
              </span>
            )}

            {h.action === "insert" && h.now_is && (
              <span className="text-[var(--muted)]">{h.now_is}</span>
            )}

            {h.action === "delete" && h.was && (
              <span className="text-[var(--muted)]">{h.was}</span>
            )}

            {h.is_system && <Badge>auto</Badge>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
