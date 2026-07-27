import AppShell from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import TimeOffReport from "./time-off-report";

export default async function TimeOffReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; codes?: string };
}) {
  await requireAdmin();
  const sb = supabaseServer();

  // default to the current month if no range given
  const today = new Date();
  const defaultFrom =
    searchParams.from ??
    new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = searchParams.to ?? today.toISOString().slice(0, 10);

  const selectedCodes = searchParams.codes
    ? searchParams.codes.split(",").filter(Boolean)
    : null;

  const [{ data: allCodes }, { data: rows }, { data: totals }] = await Promise.all([
    sb
      .from("time_off_codes")
      .select("id, code, description, sort_order")
      .eq("active", true)
      .order("sort_order")
      .order("code"),
    sb.rpc("time_off_report", {
      p_from: defaultFrom,
      p_to: defaultTo,
      p_codes: selectedCodes,
    }),
    sb.rpc("time_off_report_totals", {
      p_from: defaultFrom,
      p_to: defaultTo,
      p_codes: selectedCodes,
    }),
  ]);

  return (
    <AppShell>
      <TimeOffReport
        codes={allCodes ?? []}
        rows={rows ?? []}
        totals={totals ?? []}
        from={defaultFrom}
        to={defaultTo}
        selectedCodes={selectedCodes}
      />
    </AppShell>
  );
}
