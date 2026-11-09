import { ArrowLeft, CalendarClock, KeyRound, MapPin, OctagonAlert, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { type GridItem, PhotoGrid } from "@/components/photos/photo-grid";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { StatusPill } from "@/components/status";
import { formatBooking, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireTaskUser } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { ROOMS } from "@/server/findings";
import { getTaskDetail } from "@/server/queries/tasks";
import { ActionBar } from "./action-bar";
import { ChecklistPanel } from "./checklist-panel";
import { FindingsPanel } from "./findings-panel";
import { LinkForm } from "./link-form";

export const metadata: Metadata = { title: "Task" };

export default function TaskPage(props: PageProps<"/tasks/[stepId]">) {
  return (
    <Suspense fallback={<div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>}>
      <TaskContent params={props.params} />
    </Suspense>
  );
}

async function TaskContent({ params }: { params: Promise<{ stepId: string }> }) {
  const { stepId } = await params;
  const user = await requireTaskUser(`/tasks/${stepId}`);
  await connection();
  if (!z.uuid().safeParse(stepId).success) notFound();
  const task = (await getTaskDetail(await getDb(), user.person.id, stepId)) ?? notFound();

  const { step, turnover: t, summary, property } = task;
  const active = summary.state === "active";
  const myItems = (stepFilter: (a: (typeof task.attachments)[number]) => boolean): GridItem[] =>
    task.attachments.filter(stepFilter).map((a) => ({
      id: a.id,
      kind: a.kind,
      fileName: a.fileName,
      url: a.url,
      caption: a.caption,
      canRemove: a.uploadedById === user.person.id,
    }));
  const stepPhotos = myItems((a) => a.stepId === step.id && !a.findingId);
  const otherPhotos = task.attachments.filter((a) => a.stepId !== step.id && a.kind !== "link");
  const findingPhotos = Object.fromEntries(task.findings.map((f) => [f.id, myItems((a) => a.findingId === f.id)]));
  const isPhotos = step.key === "photos" || /photo/i.test(step.name);
  const isLeasing = step.key === "leasing" || /leasing|listing/i.test(step.name);
  const allPhotoCount = task.attachments.filter((a) => a.kind === "photo").length;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <Link href="/tasks" className="inline-flex h-10 items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Your tasks
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {property.name} {t.unit}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-lg">{step.name}</span>
          <StatusPill status={step.status} />
          {active ? null : <span className="text-sm text-muted-foreground">Not your turn yet</span>}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          {step.scheduledOn ? (
            <span className={cn("inline-flex items-center gap-1", summary.bookingPassed && "font-medium text-danger")}>
              <CalendarClock className="size-4" aria-hidden /> Booked {formatBooking(step.scheduledOn, step.scheduledTime)}
              {summary.bookingPassed ? " (that day has passed)" : ""}
            </span>
          ) : null}
          {active && step.dueOn ? <span className={cn(summary.late && "font-medium text-danger")}>Due {formatMonthDay(step.dueOn)}{summary.late ? " (late)" : ""}</span> : null}
        </p>
      </div>

      {step.status === "blocked" ? (
        <p className="flex gap-2 rounded-xl bg-st-blocked-bg p-4 text-st-blocked-fg">
          <OctagonAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Blocked: </span>
            {step.blockedReason}
          </span>
        </p>
      ) : null}
      {step.reworkCount > 0 && active ? (
        <p className="flex items-center gap-2 rounded-xl bg-st-progress-bg p-3 text-sm text-st-progress-fg">
          <Undo2 className="size-4 shrink-0" aria-hidden /> This unit was sent back to you. The fix is on your checklist.
        </p>
      ) : null}

      <section aria-label="The unit" className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
        {property.address ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(property.address)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2 text-primary"
          >
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {property.address}
          </a>
        ) : null}
        {property.accessNotes ? (
          <p className="flex items-start gap-2 rounded-md bg-st-scheduled-bg p-2 text-st-scheduled-fg">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Access: </span>
              {property.accessNotes}
            </span>
          </p>
        ) : null}
        <p className="text-muted-foreground">
          Moved out {formatMonthDay(t.moveOutDate) || "(not set)"} · Ready by {formatMonthDay(t.targetReadyDate) || "(no target)"}
        </p>
        {t.notes ? <p>{t.notes}</p> : null}
      </section>

      {!active ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          You&apos;re booked for this. The steps before yours aren&apos;t finished yet; you&apos;ll get a text when the unit is ready for you.
        </p>
      ) : (
        <>
          {step.kind === "inspection" ? (
            <FindingsPanel
              turnoverId={t.id}
              stepId={step.id}
              rooms={[...ROOMS]}
              findings={task.findings.map((f) => ({ id: f.id, room: f.room, description: f.description, needsWork: f.needsWork }))}
              photos={findingPhotos}
            />
          ) : null}

          <ChecklistPanel
            turnoverId={t.id}
            stepId={step.id}
            kind={step.kind}
            items={step.checklist.map((c) => ({ id: c.id, text: c.text, state: c.state, source: c.source }))}
            requireChecklist={step.requireChecklist}
          />

          {isLeasing && allPhotoCount > 0 ? (
            <section aria-label="Listing photos" className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold">Photos for the listing</h2>
              <p className="mt-1 text-sm text-muted-foreground">{allPhotoCount} photos of this unit.</p>
              <a href={`/api/files/zip?turnoverId=${t.id}`} className="mt-3 inline-flex h-12 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground">
                Download all photos (.zip)
              </a>
            </section>
          ) : null}

          <section aria-label="Photos" className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">{isPhotos ? "Final photos" : "Photos"}</h2>
            {isPhotos ? (
              <p className="text-sm text-muted-foreground">Upload the finished photos at full quality, or add a link to the folder.</p>
            ) : null}
            <PhotoGrid items={stepPhotos} />
            <PhotoUploader turnoverId={t.id} stepId={step.id} fullQuality={isPhotos} />
            {isPhotos || isLeasing ? <LinkForm turnoverId={t.id} stepId={step.id} placeholder={isLeasing ? "Link to the posted listing" : "Dropbox or Google Drive folder"} /> : null}
          </section>

          {otherPhotos.length > 0 ? (
            <details className="rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer font-semibold">Earlier photos of this unit ({otherPhotos.length})</summary>
              <div className="mt-3 space-y-3">
                {[...new Set(otherPhotos.map((a) => a.stepId))].map((sid) => (
                  <div key={sid ?? "general"}>
                    <h3 className="mb-1 text-sm text-muted-foreground">{(sid && task.stepNames.get(sid)) || "General"}</h3>
                    <PhotoGrid
                      items={otherPhotos
                        .filter((a) => a.stepId === sid)
                        .map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, url: a.url, caption: a.caption, canRemove: false }))}
                    />
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {task.recent.length > 0 ? (
            <section aria-label="Recent notes" className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold">Recent notes</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {task.recent.slice(0, 6).map((e) => (
                  <li key={e.key}>
                    <p>{e.text}</p>
                    {e.detail ? <p className="text-muted-foreground">{e.detail}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ActionBar
            turnoverId={t.id}
            stepId={step.id}
            stepName={step.name}
            kind={step.kind}
            status={step.status}
            requireChecklist={step.requireChecklist}
            openItems={step.checklist.filter((c) => c.state === "open").length}
            findingsNeedingWork={task.findings.filter((f) => f.needsWork).length}
            findingsTotal={task.findings.length}
            scopeItems={step.kind === "scope" ? step.checklist.filter((c) => c.state !== "dropped").length : 0}
            scheduledOn={step.scheduledOn}
            scheduledTime={step.scheduledTime}
            sendBackTargets={task.sendBackTargets}
          />
        </>
      )}
    </div>
  );
}
