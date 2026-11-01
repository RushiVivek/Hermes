"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

/** Brand header shared by the form and its loading fallback, so the page
 * doesn't jump when the form hydrates. */
function Brand() {
  return (
    <div className="flex flex-col items-center text-center">
      <BrandMark size={56} />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">hermes</h1>
      <p className="mt-1 text-base text-zinc-600 dark:text-zinc-400">
        Our family&apos;s documents, in one safe place
      </p>
    </div>
  );
}

/** Same outer shape as LoginForm so the page doesn't flash blank. */
function LoginShell() {
  return (
    <div className="flex min-h-[85vh] flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm" aria-busy="true">
        <Brand />
        <div className="mt-10 space-y-4">
          <div className="h-[52px] animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
          <div className="h-[52px] animate-pulse rounded-xl bg-zinc-300/70 dark:bg-zinc-700/70" />
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
  const [show, setShow] = useState(false);
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
        setError((data?.error as string) || "Couldn't sign in. Please try again.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Couldn't reach hermes. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[85vh] flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Brand />

        <form
          onSubmit={onSubmit}
          className="mt-10 space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* Hidden username lets password managers save/fill this vault's entry. */}
          <input type="text" name="username" autoComplete="username" value="hermes" readOnly hidden />

          <div>
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Family password
            </label>
            <div className="relative mt-1.5">
              <input
                id="password"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-error" : undefined}
                className="w-full rounded-xl border border-zinc-300 bg-white py-3 pl-4 pr-14 text-base outline-none transition-colors focus:border-primary aria-[invalid]:border-red-500 dark:border-zinc-700 dark:bg-zinc-950"
                style={{ minHeight: 52 }}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                aria-pressed={show}
                className="absolute inset-y-0 right-1 my-auto flex h-11 w-11 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {error && (
            <p
              id="login-error"
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || password === ""}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
            style={{ minHeight: 52 }}
          >
            {busy && <Spinner />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Don&apos;t know the password? Ask whoever set up hermes for the family.
        </p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg aria-hidden className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
