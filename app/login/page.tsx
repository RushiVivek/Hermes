"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

/** Same outer shape as LoginForm so the page doesn't flash blank. */
function LoginSkeleton() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">hermes</h1>
        <p className="mt-1 text-sm text-zinc-500">Family document vault</p>
        <div className="mt-8 space-y-4">
          <div className="h-12 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/60" />
          <div className="h-12 rounded-lg bg-zinc-300/60 dark:bg-zinc-700/60" />
        </div>
      </div>
    </div>
  );
}

/**
 * Returns a safe same-origin redirect target. Anything that isn't a single
 * "/" followed by a non-slash, non-backslash, non-whitespace character is
 * dropped to the default landing page. This prevents `?next=https://evil.com`
 * style open-redirect phishing AND whitespace bypasses like `/\t//evil.com`
 * that the WHATWG URL parser would later collapse to `//evil.com`.
 */
function safeNext(raw: string | null): string {
  if (!raw) return "/browse";
  // Must be exactly: "/" + (a non-slash, non-backslash, non-whitespace, non-control char)
  // …followed by any allowed path/query/hash characters.
  if (!/^\/[^/\\\s\x00-\x1f]/.test(raw)) return "/browse";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Use `||` not `??` so empty-string errors fall back to the generic message.
        setError((data?.error as string) || "Couldn't sign in");
        return;
      }
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">hermes</h1>
        <p className="mt-1 text-sm text-zinc-500">Family document vault</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">Password</span>
            <input
              type="password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
              style={{ minHeight: 48 }}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-zinc-950 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
            style={{ minHeight: 48 }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
