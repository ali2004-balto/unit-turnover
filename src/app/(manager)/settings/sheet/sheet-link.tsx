"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { newSheetLinkAction, removeSheetLinkAction } from "./actions";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs"
      />
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Submit({ children, variant = "secondary" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {children}
    </Button>
  );
}

export function MakeLinkButton({ replace = false }: { replace?: boolean }) {
  return (
    <form
      action={newSheetLinkAction}
      onSubmit={(e) => {
        if (replace && !confirm("Make a new link? The current one stops working, so the formula in your sheet will need the new link.")) e.preventDefault();
      }}
    >
      <Submit variant={replace ? "secondary" : "primary"}>{replace ? "Make a new link" : "Make a link"}</Submit>
    </form>
  );
}

export function TurnOffButton() {
  return (
    <form
      action={removeSheetLinkAction}
      onSubmit={(e) => {
        if (!confirm("Turn the link off? Your sheet stops updating.")) e.preventDefault();
      }}
    >
      <Submit variant="ghost">Turn off</Submit>
    </form>
  );
}
