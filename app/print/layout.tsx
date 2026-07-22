/**
 * Bare layout — no app shell. The print view is a document, not a page
 * in the app, so nav and chrome would only end up in the PDF.
 */
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="tc-root">{children}</div>;
}
