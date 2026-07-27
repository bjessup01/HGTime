"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; links: NavLink[] };

export default function Nav({
  links,
  groups,
}: {
  links: NavLink[];
  groups: NavGroup[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // close when navigating
  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  const linkClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm transition ${
      active
        ? "bg-[var(--bg)] font-medium text-[var(--ink)]"
        : "text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
    }`;

  return (
    <nav ref={navRef} className="flex flex-wrap items-center gap-1">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={linkClass(isActive(l.href))}>
          {l.label}
        </Link>
      ))}

      {groups.map((g) => {
        const groupActive = g.links.some((l) => isActive(l.href));
        const isOpen = open === g.label;

        return (
          <div key={g.label} className="relative">
            <button
              onClick={() => setOpen(isOpen ? null : g.label)}
              aria-expanded={isOpen}
              aria-haspopup="true"
              className={linkClass(groupActive) + " inline-flex items-center gap-1"}
            >
              {g.label}
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
              >
                <path
                  d="M2 4l3 3 3-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {isOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[11rem] rounded-md border border-[var(--line)] bg-[var(--panel)] py-1 shadow-lg">
                {g.links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`block px-3 py-2 text-sm transition ${
                      isActive(l.href)
                        ? "bg-[var(--bg)] font-medium text-[var(--ink)]"
                        : "text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
