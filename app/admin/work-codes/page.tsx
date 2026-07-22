import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Panel, Table, Badge, Empty } from "@/components/ui";
import WorkCodeForm from "./work-code-form";
import ToggleWorkCode from "./toggle-work-code";

export default async function WorkCodesPage() {
  await requireAdmin();
  const sb = supabaseServer();

  const { data: codes } = await sb.from("work_codes").select("*").order("code");
  const { data: timeOff } = await sb
    .from("time_off_codes")
    .select("*")
    .order("sort_order");

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Codes</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Work codes are editable. Time-off codes are fixed by payroll configuration.
          </p>
        </div>

        <WorkCodeForm />

        <Panel title="Work codes" description={`${codes?.length ?? 0} defined`}>
          {!codes?.length ? (
            <Empty>No work codes yet. Add one above.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </>
              }
            >
              {codes.map((c: any) => (
                <tr key={c.id} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-3 pr-4 font-mono text-xs font-semibold">{c.code}</td>
                  <td className="py-3 pr-4">{c.description}</td>
                  <td className="py-3 pr-4">
                    {c.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}
                  </td>
                  <td className="py-3">
                    <ToggleWorkCode id={c.id} active={c.active} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel
          title="Time-off codes"
          description="Bucket determines how hours export to payroll. Holiday is the only code counting toward overtime."
        >
          <Table
            head={
              <>
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Description</th>
                <th className="py-2 pr-4 font-medium">Bank</th>
                <th className="py-2 pr-4 font-medium">Bucket</th>
                <th className="py-2 pr-4 font-medium">Notes</th>
              </>
            }
          >
            {timeOff?.map((c: any) => (
              <tr key={c.id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-3 pr-4 font-mono text-xs font-semibold">{c.code}</td>
                <td className="py-3 pr-4">{c.description}</td>
                <td className="py-3 pr-4 capitalize">{c.bank ?? "—"}</td>
                <td className="py-3 pr-4 capitalize">{c.bucket}</td>
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap gap-1">
                    {c.counts_toward_ot && <Badge tone="warn">Counts toward OT</Badge>}
                    {c.payroll_admin_only && <Badge>Admin only</Badge>}
                    {c.requires_zero_hours && <Badge>0 hours</Badge>}
                    {c.default_unpaid && <Badge>Unpaid</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </AppShell>
  );
}
