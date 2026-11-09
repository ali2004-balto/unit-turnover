"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { type GridItem, PhotoGrid } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { deleteFindingAction, saveFindingAction, type TaskState } from "./actions";

interface Finding {
  id: string;
  room: string;
  description: string;
  needsWork: boolean;
}

/** The inspector's findings, room by room. Each one that needs work becomes a scope item for the manager. */
export function FindingsPanel({
  turnoverId,
  stepId,
  rooms,
  findings,
  photos,
}: {
  turnoverId: string;
  stepId: string;
  rooms: string[];
  findings: Finding[];
  photos: Record<string, GridItem[]>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsWork = findings.filter((f) => f.needsWork).length;

  return (
    <section aria-labelledby="findings" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 id="findings" className="font-semibold">
          Findings
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add each thing that needs work, room by room, with a photo. They become the scope of work for the manager to approve.
        </p>
      </div>

      {findings.length > 0 ? (
        <ul className="space-y-3" aria-busy={pending}>
          {findings.map((f) =>
            editing === f.id ? (
              <li key={f.id}>
                <FindingForm turnoverId={turnoverId} stepId={stepId} rooms={rooms} finding={f} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={f.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{f.room}</p>
                    <p className="mt-0.5">{f.description}</p>
                    <span
                      className={cn(
                        "mt-1 inline-block rounded px-1.5 py-0.5 text-xs",
                        f.needsWork ? "bg-st-progress-bg text-st-progress-fg" : "bg-st-na-bg text-st-na-fg",
                      )}
                    >
                      {f.needsWork ? "Needs work" : "Just a note"}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Edit finding in ${f.room}`} onClick={() => setEditing(f.id)}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove finding in ${f.room}`}
                    onClick={() =>
                      start(async () => {
                        if (window.confirm("Remove this finding and its photos?")) await deleteFindingAction(turnoverId, stepId, f.id);
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  <PhotoGrid items={photos[f.id] ?? []} />
                  <PhotoUploader turnoverId={turnoverId} stepId={stepId} findingId={f.id} size="md" />
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {editing === null ? <FindingForm turnoverId={turnoverId} stepId={stepId} rooms={rooms} /> : null}

      {findings.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {needsWork === 0 ? "Nothing needs work so far." : `${needsWork} thing${needsWork === 1 ? "" : "s"} need${needsWork === 1 ? "s" : ""} work.`}
        </p>
      ) : null}
    </section>
  );
}

function FindingForm({
  turnoverId,
  stepId,
  rooms,
  finding,
  onDone,
}: {
  turnoverId: string;
  stepId: string;
  rooms: string[];
  finding?: Finding;
  onDone?: () => void;
}) {
  const known = !finding || rooms.includes(finding.room);
  const [room, setRoom] = useState(finding ? (known ? finding.room : "Other") : "");
  const [needsWork, setNeedsWork] = useState(finding?.needsWork ?? true);
  const [state, action, pending] = useActionState<TaskState, FormData>(async (previous, form) => {
    const result = await saveFindingAction(previous, form);
    if (result.ok) {
      // Ready for the next finding (the text box clears itself).
      setRoom("");
      setNeedsWork(true);
      onDone?.();
    }
    return result;
  }, {});
  const id = finding?.id ?? "new";

  return (
    <form action={action} className="space-y-3 rounded-lg border border-dashed border-border p-3">
      <input type="hidden" name="turnoverId" value={turnoverId} />
      <input type="hidden" name="stepId" value={stepId} />
      {finding ? <input type="hidden" name="findingId" value={finding.id} /> : null}
      <input type="hidden" name="needsWork" value={needsWork ? "yes" : "no"} />
      <p className="text-sm font-medium">{finding ? "Edit finding" : "Add a finding"}</p>
      <Field label="Room" htmlFor={`room-${id}`}>
        <Select id={`room-${id}`} name="room" value={room} onChange={(e) => setRoom(e.target.value)} required className="h-12 text-base">
          <option value="" disabled>
            Pick a room
          </option>
          {rooms.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="Other">Other…</option>
        </Select>
      </Field>
      {room === "Other" ? (
        <Field label="Which room?" htmlFor={`other-${id}`}>
          <Input id={`other-${id}`} name="otherRoom" required maxLength={40} defaultValue={known ? "" : finding?.room} className="h-12 text-base" />
        </Field>
      ) : null}
      <Field label="What did you find?" htmlFor={`desc-${id}`}>
        <Textarea
          id={`desc-${id}`}
          name="description"
          required
          maxLength={500}
          defaultValue={finding?.description}
          placeholder="e.g. Cracked tile by the fridge"
          className="text-base"
        />
      </Field>
      <div role="radiogroup" aria-label="Does it need work?" className="grid grid-cols-2 gap-2">
        {[
          { value: true, label: "Needs work" },
          { value: false, label: "Just a note" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={needsWork === o.value}
            onClick={() => setNeedsWork(o.value)}
            className={cn(
              "h-12 rounded-md border text-sm font-medium",
              needsWork === o.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <FormError message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending} className="flex-1">
          {pending ? "Saving…" : finding ? "Save" : "Add finding"}
        </Button>
        {onDone ? (
          <Button variant="secondary" size="lg" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
