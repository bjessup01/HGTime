"use client";

export default function PrintControls({
  count,
  label,
}: {
  count: number;
  label?: string;
}) {
  return (
    <div className="tc-controls">
      <span>
        {label ??
          `${count} timecard${count === 1 ? "" : "s"} ready`}
      </span>
      <button onClick={() => window.print()} className="tc-print-btn">
        Print / Save as PDF
      </button>
      <span className="tc-controls-hint">
        In the print dialog choose &ldquo;Save as PDF&rdquo; as the destination.
      </span>
    </div>
  );
}
