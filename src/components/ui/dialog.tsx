"use client";

import { X } from "lucide-react";
import { createContext, use, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

const DialogContext = createContext<{ close: () => void } | null>(null);

/** Closes the dialog it's inside (e.g. after a form saves). */
export function useCloseDialog(): () => void {
  return use(DialogContext)?.close ?? (() => {});
}

/**
 * A modal built on the browser's own <dialog> element: it traps focus,
 * closes with Escape, and returns focus to the button that opened it.
 */
export function Dialog({
  trigger,
  triggerProps,
  title,
  description,
  children,
  className,
}: {
  trigger: React.ReactNode;
  triggerProps?: ButtonProps;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <>
      <Button variant="secondary" size="sm" {...triggerProps} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
        className={cn(
          "m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50",
          className,
        )}
      >
        {open ? (
          <DialogContext value={{ close: () => setOpen(false) }}>
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">{title}</h2>
                {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)} className="-mt-1 -mr-2">
                <X />
              </Button>
            </div>
            <div className="px-5 py-4">{children}</div>
          </DialogContext>
        ) : null}
      </dialog>
    </>
  );
}
