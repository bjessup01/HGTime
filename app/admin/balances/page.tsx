import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Panel, Table, Badge, Empty } from "@/components/ui";
import BalanceTools from "./balance-tools";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export default async function BalancesPage() {
  await requireAdmin();
  const sb = supabaseServer();

  const { data: employees } = await sb
    .from("employee_current")
    .select("id, employee_number, first_name, last_name")
    .eq("active", true)
    .order("employee_number");

  // latest snapshot per employee per bank
  const { data: snapshots } = await sb
    .from("balance_snapshots")
    .select("employee_id, bank, hours, as_of_date, source")
    .order("as_of_date", { ascending: false });

  const latest = new Map<string, any>();
  for (const s of snapshots ?? []) {
    const key = `${s.employee_id}:${s.bank}`;
    if (!latest.has(key)) latest.set(key, s);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Balances</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Vacation and sick balances come from payroll after each run. Floating
            holiday is tracked here automatically.
          </p>
        </div>

        <BalanceTools />

        <Panel title="Current balances">
          {!employees?.length ? (
            <Empty>No active employees.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th className="py-2 pr-4 font-medium">#</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Vacation</th>
                  <th className="py-2 pr-4 font-medium">Sick</th>
                  <th className="py-2 font-medium">As of</th>
                </>
              }
            >
              {employees.map((e: any) => {
                const vac = latest.get(`${e.id}:vacation`);
                const sick = latest.get(`${e.id}:sick`);
                const asOf = vac?.as_of_date ?? sick?.as_of_date ?? null;

                return (
                  <tr key={e.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs">{e.employee_number}</td>
                    <td className="py-3 pr-4">
                      {e.first_name} {e.last_name}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {vac ? Number(vac.hours) : <span className="text-[var(--muted)]">—</span>}
                      {vac?.source === "manual" && (
                        <span className="ml-2">
                          <Badge>manual</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {sick ? Number(sick.hours) : <span className="text-[var(--muted)]">—</span>}
                      {sick?.source === "manual" && (
                        <span className="ml-2">
                          <Badge>manual</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-[var(--muted)]">{fmtDate(asOf)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
