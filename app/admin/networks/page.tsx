import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer, clientIp } from "@/lib/supabase";
import { Panel, Table, Badge, Empty } from "@/components/ui";
import NetworkForm from "./network-form";
import NetworkActions from "./network-actions";

export default async function NetworksPage() {
  await requireAdmin();
  const sb = supabaseServer();
  const ip = clientIp();

  const { data: networks } = await sb
    .from("network_allowlist")
    .select("*")
    .order("location");

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Company networks</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Employees without remote-entry permission can only enter time from these
            addresses. Supervisors and payroll admins are never restricted.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-5 py-4">
          <p className="text-sm">
            Your current IP address:{" "}
            <span className="font-mono font-semibold">{ip ?? "unavailable"}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Visit this page from each location to find the address to add. Note that a
            phone on cellular data will show a different address than the same phone on
            the location&apos;s WiFi.
          </p>
        </div>

        <NetworkForm currentIp={ip} />

        <Panel title="Allowlist" description={`${networks?.length ?? 0} entries`}>
          {!networks?.length ? (
            <Empty>
              No networks yet. Until one is added, employees without remote permission
              cannot enter time.
            </Empty>
          ) : (
            <Table
              head={
                <>
                  <th className="py-2 pr-4 font-medium">Location</th>
                  <th className="py-2 pr-4 font-medium">Address / range</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium"></th>
                </>
              }
            >
              {networks.map((n: any) => (
                <tr key={n.id} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-3 pr-4">{n.location}</td>
                  <td className="py-3 pr-4 font-mono text-xs">{n.cidr}</td>
                  <td className="py-3 pr-4">
                    {n.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}
                  </td>
                  <td className="py-3">
                    <NetworkActions id={n.id} active={n.active} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
