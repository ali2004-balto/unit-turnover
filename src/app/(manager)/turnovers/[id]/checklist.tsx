"use client";

import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import type { ChecklistSource, ChecklistState, StepKind } from "@/domain/workflow/types";
import { cn } from "@/lib/utils";
import { CommandForm, SubmitButton } from "./command-form";

interface Item {
  id: string;
  text: string;
  state: ChecklistState;
  source: ChecklistSource;
}

const STATE_LABELS: Record<ChecklistState, string> = {
  open: "To do",
  done: "Done",
  to_confirm: "To confirm",
  dropped: "Dropped",
};

/**
 * A step's checklist. On the scope step the items are the scope of work:
 * each can be kept, marked "to confirm" or dropped before approval.
 */
export function Checklist({
  stepId,
  kind,
  items,
  finished,
  canTick,
  collapsed,
}: {
  stepId: string;
  kind: StepKind;
  items: Item[];
  finished: boolean;
  canTick: boolean;
  collapsed: boolean;
}) {
  const isScope = kind === "scope";
  const visible = items.filter((i) => isScope || i.state !== "dropped");
  const done = visible.filter((i) => i.state === "done").length;
  const title = isScope ? "Scope of work" : "Checklist";
  const countable = visible.filter((i) => i.state !== "to_confirm").length;

  if (visible.length === 0 && (finished || (!isScope && kind !== "work"))) return null;

  const body = (
    <div className="space-y-1.5">
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isScope ? "No scope items yet. Add what needs doing, or approve with none to skip in-house work." : "Nothing on the checklist."}
        </p>
      ) : (
        <ul className="space-y-1">
          {visible.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              {isScope ? (
                <ScopeItem stepId={stepId} item={item} disabled={finished} />
              ) : (
                <TickItem stepId={stepId} item={item} disabled={!canTick} />
              )}
            </li>
          ))}
        </ul>
      )}
      {!finished ? <AddItem stepId={stepId} isScope={isScope} /> : null}
    </div>
  );

  const heading = (
    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {title}
      {!isScope && countable > 0 ? ` · ${done} of ${countable}` : ""}
      {isScope ? ` · ${visible.filter((i) => i.state !== "dropped").length} items` : ""}
    </span>
  );

  if (collapsed) {
    return (
      <details className="rounded-md">
        <summary className="cursor-pointer select-none">{heading}</summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return (
    <div className="space-y-1.5">
      {heading}
      {body}
    </div>
  );
}

function TickItem({ stepId, item, disabled }: { stepId: string; item: Item; disabled: boolean }) {
  const done = item.state === "done";
  return (
    <CommandForm
      type="setChecklistItemState"
      fields={{ stepId, itemId: item.id, state: done ? "open" : "done" }}
      checkVersion={false}
      className="flex w-full items-start gap-2"
    >
      <input
        type="checkbox"
        id={`item-${item.id}`}
        defaultChecked={done}
        disabled={disabled}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <label htmlFor={`item-${item.id}`} className={cn("text-sm", done && "text-muted-foreground line-through")}>
        {item.text}
        {item.state === "to_confirm" ? (
          <span className="ml-2 rounded bg-st-progress-bg px-1.5 py-0.5 text-[11px] text-st-progress-fg no-underline">To confirm</span>
        ) : null}
        {item.source === "send_back" ? (
          <span className="ml-2 rounded bg-st-blocked-bg px-1.5 py-0.5 text-[11px] text-st-blocked-fg">Rework</span>
        ) : null}
      </label>
    </CommandForm>
  );
}

function ScopeItem({ stepId, item, disabled }: { stepId: string; item: Item; disabled: boolean }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <span className={cn("min-w-0 flex-1 text-sm", item.state === "dropped" && "text-muted-foreground line-through")}>{item.text}</span>
      <CommandForm type="setChecklistItemState" fields={{ stepId, itemId: item.id }} checkVersion={false} showError={false}>
        <label className="sr-only" htmlFor={`scope-${item.id}`}>
          Status of {item.text}
        </label>
        <Select
          id={`scope-${item.id}`}
          name="state"
          defaultValue={item.state === "done" ? "open" : item.state}
          disabled={disabled}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-8 w-32 text-xs"
        >
          {(["open", "to_confirm", "dropped"] as const).map((s) => (
            <option key={s} value={s}>
              {STATE_LABELS[s]}
            </option>
          ))}
        </Select>
      </CommandForm>
      {!disabled ? (
        <Dialog trigger="Edit" triggerProps={{ variant: "ghost", size: "sm" }} title="Edit scope item">
          <CommandForm type="editChecklistItem" fields={{ stepId, itemId: item.id }} checkVersion={false} className="flex flex-col gap-3">
            <Field label="Item" htmlFor={`edit-${item.id}`}>
              <Input id={`edit-${item.id}`} name="text" defaultValue={item.text} required maxLength={300} />
            </Field>
            <SubmitButton className="self-end">Save</SubmitButton>
          </CommandForm>
        </Dialog>
      ) : null}
    </div>
  );
}

function AddItem({ stepId, isScope }: { stepId: string; isScope: boolean }) {
  return (
    <CommandForm type="addChecklistItem" fields={{ stepId }} checkVersion={false} className="flex gap-2 pt-1">
      <label className="sr-only" htmlFor={`add-${stepId}`}>
        {isScope ? "Add a scope item" : "Add a checklist item"}
      </label>
      <Input
        id={`add-${stepId}`}
        name="text"
        required
        maxLength={300}
        placeholder={isScope ? "Add what needs doing, e.g. Touch up paint" : "Add an item"}
        className="h-9"
      />
      <SubmitButton variant="secondary" size="md" className="h-9 shrink-0" pendingText="Adding…">
        <Plus aria-hidden /> Add
      </SubmitButton>
    </CommandForm>
  );
}
