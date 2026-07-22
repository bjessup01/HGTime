import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Browser client — respects RLS as the signed-in user. */
export function supabaseBrowser() {
  return createBrowserClient(URL, ANON);
}

/** Server client — respects RLS, reads the session from cookies. */
export function supabaseServer() {
  const store = cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options?: any }[]) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component; middleware refreshes the session
        }
      },
    },
  });
}

/**
 * Admin client — bypasses RLS. Only ever used in server actions for
 * provisioning accounts and resetting PINs. Never import into client code.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Employee number -> synthetic email. Employees never see or type this. */
export function employeeEmail(employeeNumber: string) {
  const domain = process.env.EMPLOYEE_EMAIL_DOMAIN || "timekeeping.local";
  return `${employeeNumber.trim().toLowerCase()}@${domain}`;
}

/**
 * Client IP as seen by Vercel. x-forwarded-for is a comma-separated chain;
 * the first entry is the original client.
 */
export function clientIp(): string | null {
  const h = headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") || null;
}

/** Six-digit PIN, uniformly random, no leading-zero bias. */
export function generatePin(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}
