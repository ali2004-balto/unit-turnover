"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createSignInLinkAction, type LinkResult } from "@/app/(manager)/link-actions";
import { Button } from "@/components/ui/button";

/** Makes a sign-in link for a person (optionally straight to one task) that a manager can copy and send. */
export function SignInLinkButton({ personId, personName, stepId, label = "Sign-in link" }: { personId: string; personName: string; stepId?: string; label?: string }) {
  const [result, setResult] = useState<LinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  if (!result?.url) {
    return (
      <span className="inline-flex flex-col">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => setResult(await createSignInLinkAction(personId, stepId)))}
        >
          <Link2 aria-hidden /> {pending ? "Making link…" : label}
        </Button>
        {result?.error ? <span className="text-xs text-danger">{result.error}</span> : null}
      </span>
    );
  }
  return (
    <div className="w-full max-w-md space-y-1.5 rounded-md border border-border bg-muted/50 p-2 text-left text-xs">
      <p className="text-muted-foreground">
        Send this to {personName} only: it signs them in to their tasks for {result.days} days.
      </p>
      <div className="flex items-center gap-1.5">
        <input readOnly value={result.url} aria-label={`Sign-in link for ${personName}`} className="h-8 min-w-0 flex-1 rounded border border-border bg-card px-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(result.url!);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
        <a href={result.url} target="_blank" rel="noreferrer" className="h-8 content-center px-2 text-primary hover:underline">
          Open
        </a>
      </div>
    </div>
  );
}
