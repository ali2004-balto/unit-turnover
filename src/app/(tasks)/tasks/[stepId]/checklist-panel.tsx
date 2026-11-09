"use client";

import { Plus } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import type { ChecklistSource, ChecklistState, StepKind } from "@/domain/workflow/types";
import { cn } from "@/lib/utils";
import { TaskForm, TaskSubmit } from "./task-form";

interface Item {
  id: string;
  text: string;
  state: ChecklistState;
  source: ChecklistSource;
}

/** Big checkboxes for the task's checklist. On a scope review, each item can be kept, marked to confirm, or dropped. */
export function ChecklistPanel({
  turnoverId,
  stepId,
  kind,
  items,
  requireChecklist,
}: {
  turnoverId: string;
  stepId: string;
  kind: StepKind;
  items: Item[];
  requireChecklist: boolean;
}) {
  const isScope = kind === "scope";
  const visible = items.filter((i) => isScope || i.state !== "dropped");
  if (visible.length === 0 && kind !== "work" && !isScope) return null;
  const countable = visible.filter((i) => i.state === "open" || i.state === "done");
  const done = countable.filter((i) => i.state === "done").length;

  return (
    <section aria-labelledby="checklist" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="checklist" className="font-semibold">
          {isScope ? "Scope of work" : kind === "work" ? "What needs doing" : "Checklist"}
        </h2>
        {!isScope && countable.length > 0 ? (
          <span className="text-sm text-muted-foreground">
            {done} of {countable.length} done
          </span>
        ) : null}
      </div>
      {requireChecklist && !isScope ? <p className="-mt-2 text-sm text-muted-foreground">Tick each one off as you finish it.</p> : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{isScope ? "The inspection found nothing that needs work." : "Nothing listed."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((item) => (
            <li key={item.id} className="py-1">
              {isScope ? <ScopeRow turnoverId={turnoverId} stepId={stepId} item={item} /> : <TickRow turnoverId={turnoverId} stepId={stepId} item={item} />}
            </li>
          ))}
        </ul>
      )}

      {kind === "work" || isScope ? (
        <TaskForm turnoverId={turnoverId} type="addChecklistItem" fields={{ stepId }} className="flex gap-2">
          <label className="sr-only" htmlFor={`add-${stepId}`}>
            {isScope ? "Add a scope item" : "Add something else you did"}
          </label>
          <Input
            id={`add-${stepId}`}
            name="text"
            required
            maxLength={300}
            placeholder={isScope ? "Add an item" : "Add something else you did"}
            className="h-12 text-base"
          />
          <TaskSubmit variant="secondary" size="lg" pendingText="…" aria-label="Add">
            <Plus aria-hidden />
          </TaskSubmit>
        </TaskForm>
      ) : null}
    </section>
  );
}

function TickRow({ turnoverId, stepId, item }: { turnoverId: string; stepId: string; item: Item }) {
  const done = item.state === "done";
  const toConfirm = item.state === "to_confirm";
  return (
    <TaskForm
      turnoverId={turnoverId}
      type="setChecklistItemState"
      fields={{ stepId, itemId: item.id, state: done ? "open" : "done" }}
      className="flex min-h-12 items-center gap-3"
    >
      <input
        type="checkbox"
        id={`item-${item.id}`}
        defaultChecked={done}
        disabled={toConfirm}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="size-6 shrink-0 accent-primary"
      />
      <label htmlFor={`item-${item.id}`} className={cn("flex-1 py-2 text-base", done && "text-muted-foreground line-through")}>
        {item.text}
        {toConfirm ? (
          <span className="ml-2 rounded bg-st-progress-bg px-1.5 py-0.5 text-xs text-st-progress-fg no-underline">Waiting on a decision</span>
        ) : null}
        {item.source === "send_back" ? <span className="ml-2 rounded bg-st-blocked-bg px-1.5 py-0.5 text-xs text-st-blocked-fg">Fix</span> : null}
      </label>
    </TaskForm>
  );
}

function ScopeRow({ turnoverId, stepId, item }: { turnoverId: string; stepId: string; item: Item }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={cn("min-w-0 flex-1", item.state === "dropped" && "text-muted-foreground line-through")}>{item.text}</span>
      <TaskForm turnoverId={turnoverId} type="setChecklistItemState" fields={{ stepId, itemId: item.id }} showError={false}>
        <label className="sr-only" htmlFor={`scope-${item.id}`}>
          Keep {item.text}?
        </label>
        <Select
          id={`scope-${item.id}`}
          name="state"
          defaultValue={item.state === "done" ? "open" : item.state}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-10 w-36"
        >
          <option value="open">Do it</option>
          <option value="to_confirm">To confirm</option>
          <option value="dropped">Drop it</option>
        </Select>
      </TaskForm>
    </div>
  );
}
