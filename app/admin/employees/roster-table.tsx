"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Table, Badge } from "@/components/ui";

const TYPE_LABEL: Record<string, string> = {
  salaried: "Salaried",
  full_time_hourly: "Full-time hourly",
  part_time: "Part-time",
  on_call: "On-call",
  seasonal: "Seasonal",
};

const PAYROLL_LABEL: Record<string, string> = {
  semi_monthly: "Semi-monthly",
  bi_weekly: "Bi-weekly",
};

type SortKey =
  | "number"
  | "name"
  | "payroll"
  | "type"
  | "schedule"
  | "code"
  | "status";

// value used for comparison per column
function sortValue(e: any, key: SortKey): string | number {
  switch (key) {
    case "number":
      // numeric where possible so 9 sorts before 10
      return Number(e.employee_number) || e.employee_number;
    case "name":
      return `${e.last_name} ${e.first_name}`.toLowerCase();
    case "payroll":
      return PAYROLL_LABEL[e.payroll_type] ?? "";
    case "type":
      return TYPE_LABEL[e.employee_type] ?? "";
    case "schedule":
      return e.schedule_code ?? "";
    case "code":
      return e.default_work_code ?? "";
    case "status":
      // active first, then inactive
      return e.currently_employed ? 0 : 1;
    default:
      return "";
  }
}

function SortHeader({
  label,
  col,
  sort,
  dir,
  onSort,
  className = "",
  title,
}: {
  label: string;
  col: SortKey;
  sort: SortKey;
  dir: 1 | -1;
  onSort: (c: SortKey) => void;
  className?: string;
  title?: string;
}) {
  const active = sort === col;
  return (
    <th className={`py-2 pr-4 font-medium ${className}`}>
      <button
        onClick={() => onSort(col)}
        title={title}
        className={`inline-flex items-center gap-1 hover:text-[var(--ink)] ${
          active ? "text-[var(--ink)]" : ""
        }`}
      >
        {label}
        <span
          className={`text-[10px] ${
            active ? "opacity-100" : "opacity-0"
          }`}
        >
          {dir === 1 ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

export default function RosterTable({
  employees,
  entryPeriod,
}: {
  employees: any[];
  entryPeriod?: string;
}) {
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<1 | -1>(1);
  const [query, setQuery] = useState("");
  const [showTermed, setShowTermed] = useState(false);

  function onSort(col: SortKey) {
    if (col === sort) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSort(col);
      setDir(1);
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const copy = employees.filter((e: any) => {
      // hide terminated employees unless the toggle is on
      if (!showTermed && !e.currently_employed) return false;
      if (!q) return true;
      // match against number, first, last, and "first last" / "last, first"
      const hay = [
        e.employee_number,
        e.first_name,
        e.last_name,
        `${e.first_name} ${e.last_name}`,
        `${e.last_name} ${e.first_name}`,
        `${e.last_name}, ${e.first_name}`,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    copy.sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      // stable tiebreak on last name so equal keys keep a sensible order
      if (cmp === 0) {
        cmp = `${a.last_name} ${a.first_name}`.localeCompare(
          `${b.last_name} ${b.first_name}`
        );
      }
      return cmp * dir;
    });
    return copy;
  }, [employees, sort, dir, query, showTermed]);

  const termedCount = employees.filter(
    (e: any) => !e.currently_employed
  ).length;

  const headerProps = { sort, dir, onSort };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or number…"
          className="w-64 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Clear
          </button>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showTermed}
            onChange={(e) => setShowTermed(e.target.checked)}
            className="h-4 w-4"
          />
          Show terminated
          {termedCount > 0 && (
            <span className="text-xs">({termedCount})</span>
          )}
        </label>
      </div>

      <p className="text-xs text-[var(--muted)]">
        {rows.length} employee{rows.length === 1 ? "" : "s"}
        {query || !showTermed ? " shown" : ""}
      </p>

      <Table
        head={
          <>
            <SortHeader label="#" col="number" {...headerProps} />
            <SortHeader label="Name" col="name" {...headerProps} />
            <SortHeader label="Payroll" col="payroll" {...headerProps} />
            <SortHeader label="Type" col="type" {...headerProps} />
            <SortHeader label="Schedule" col="schedule" {...headerProps} />
            <SortHeader label="Default code" col="code" {...headerProps} />
            <SortHeader
              label="Flags"
              col="status"
              title="Sort active first"
              {...headerProps}
            />
            <th className="py-2 font-medium"></th>
          </>
        }
      >
      {rows.map((e: any) => (
        <tr key={e.id} className="border-b border-[var(--line)] last:border-0">
          <td className="py-3 pr-4 font-mono text-xs">
            {e.employee_number}
            {!e.active && (
              <span className="ml-2 font-sans text-xs text-[var(--muted)]">
                inactive
              </span>
            )}
          </td>
          <td className="py-3 pr-4">
            {e.first_name} {e.last_name}
            {e.role !== "employee" && (
              <span className="ml-2">
                <Badge tone="neutral">
                  {e.role === "payroll_admin" ? "Payroll admin" : "Supervisor"}
                </Badge>
              </span>
            )}
          </td>
          <td className="py-3 pr-4">{PAYROLL_LABEL[e.payroll_type] ?? "—"}</td>
          <td className="py-3 pr-4">{TYPE_LABEL[e.employee_type] ?? "—"}</td>
          <td className="py-3 pr-4">{e.schedule_code ?? "—"}</td>
          <td className="py-3 pr-4 font-mono text-xs">
            {e.default_work_code ?? "—"}
          </td>
          <td className="py-3 pr-4">
            <div className="flex flex-wrap gap-1">
              {e.holiday_eligible && <Badge tone="good">Holiday</Badge>}
              {e.shuttle_eligible && <Badge tone="neutral">Shuttle</Badge>}
              {e.can_enter_remotely && <Badge tone="warn">Remote</Badge>}
              {!e.currently_employed && <Badge tone="bad">Termed</Badge>}
            </div>
          </td>
          <td className="py-3">
            <div className="flex gap-3">
              <Link
                href={`/timecard?employee=${e.id}${
                  entryPeriod ? `&period=${entryPeriod}` : ""
                }`}
                className="text-sm text-[var(--accent)] hover:underline"
              >
                Enter time
              </Link>
              <Link
                href={`/admin/employees/${e.id}`}
                className="text-sm text-[var(--muted)] hover:underline"
              >
                Manage
              </Link>
            </div>
          </td>
        </tr>
      ))}
      </Table>
    </div>
  );
}
