import { requireUser } from "@/lib/auth";
import { loadPrintCard, loadPrintQueue } from "@/lib/print";
import PrintableTimecard from "@/components/print/printable-timecard";
import PrintControls from "./print-controls";
import "./print.css";

function stamp() {
  const d = new Date();
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return (
    `${String(d.getMonth() + 1).padStart(2, "0")}/` +
    `${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()} ` +
    `${String(h12).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`
  );
}

export default async function PrintPage({
  searchParams,
}: {
  searchParams: { period?: string; timecard?: string; approved?: string };
}) {
  await requireUser();
  const printedAt = stamp();

  // Single card
  if (searchParams.timecard) {
    const card = await loadPrintCard(searchParams.timecard);
    if (!card) {
      return <p className="tc-message">Timecard not found.</p>;
    }
    return (
      <>
        <PrintControls count={1} />
        <PrintableTimecard card={card} printedAt={printedAt} />
      </>
    );
  }

  // Whole period
  if (!searchParams.period) {
    return <p className="tc-message">No pay period specified.</p>;
  }

  const queue = await loadPrintQueue(
    searchParams.period,
    searchParams.approved === "1"
  );

  if (queue.length === 0) {
    return (
      <p className="tc-message">
        No timecards to print for this period
        {searchParams.approved === "1" && " with supervisor approval"}.
      </p>
    );
  }

  const cards = await Promise.all(
    queue.map((q: any) => loadPrintCard(q.timecard_id))
  );

  return (
    <>
      <PrintControls count={cards.filter(Boolean).length} />
      {cards.map(
        (card, i) =>
          card && (
            <PrintableTimecard
              key={queue[i].timecard_id}
              card={card}
              printedAt={printedAt}
            />
          )
      )}
    </>
  );
}
