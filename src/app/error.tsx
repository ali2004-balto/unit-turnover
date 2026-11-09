"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page couldn&apos;t load. Try again; if it keeps happening, send this reference to whoever looks after the
        app: <code className="rounded bg-muted px-1">{error.digest ?? "no reference"}</code>
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground"
      >
        Try again
      </button>
    </main>
  );
}
