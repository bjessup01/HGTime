import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { Panel, Empty } from "@/components/ui";
import YearEndReport from "./year-end-report";

export default async function YearEndPage({
  searchParams,
}: {
  searchParams: { year?: string; view?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  const fiscalYear = searchParams.year ? Number(searchParams.year) : null;

  const [{ data: report, error }, { data: runs }, { data: config }] =
    await Promise.all([
      sb.rpc("year_end_report", { p_fiscal_year: fiscalYear }),
      sb
        .from("year_end_runs")
        .select("*, employees(first_name, last_name)")
        .order("run_at", { ascending: false })
        .limit(5),
      sb
        .from("year_end_config")
        .select("*")
        .eq("active", true)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (error) {
    return (
      <AppShell>
        <Panel title="Year-end report">
          <p className="text-sm text-red-700">{error.message}</p>
        </Panel>
      </AppShell>
    );
  }

  if (!report?.length) {
    return (
      <AppShell>
        <Panel title="Year-end report">
          <Empty>
            No balances on file yet. Import vacation and sick balances first.
          </Empty>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <YearEndReport
        rows={report}
        runs={runs ?? []}
        config={config}
        view={searchParams.view === "entry" ? "entry" : "monitor"}
      />
    </AppShell>
  );
}
