import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import AuditView from "./audit-view";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    employee?: string;
    actor?: string;
    system?: string;
  };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const includeSystem = searchParams.system === "1";

  const [{ data: rows, error }, { data: employees }, { data: purge }] =
    await Promise.all([
      sb.rpc("audit_search", {
        p_from: searchParams.from || null,
        p_to: searchParams.to || null,
        p_employee_id: searchParams.employee || null,
        p_actor_id: searchParams.actor || null,
        p_include_system: includeSystem,
        p_limit: 300,
      }),
      sb
        .from("employees")
        .select("id, first_name, last_name, employee_number")
        .order("last_name"),
      sb.rpc("audit_purge_preview"),
    ]);

  return (
    <AppShell>
      <AuditView
        rows={rows ?? []}
        error={error?.message ?? null}
        employees={employees ?? []}
        purge={(purge as any[])?.[0] ?? null}
        filters={{
          from: searchParams.from ?? "",
          to: searchParams.to ?? "",
          employee: searchParams.employee ?? "",
          actor: searchParams.actor ?? "",
          system: includeSystem,
        }}
      />
    </AppShell>
  );
}
