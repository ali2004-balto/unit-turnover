import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { FlagPill } from "@/components/status";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDateTime, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireManager } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { getTurnoverDetail } from "@/server/queries/turnover-detail";
import { TurnoverProvider } from "./command-form";
import { EditDetails } from "./edit-details";
import { NoteForm } from "./note-form";
import { StepCard } from "./step-card";
import { Timeline } from "./timeline";

export async function TurnoverContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireManager(`/turnovers/${id}`);
  await connection();
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getTurnoverDetail(await getDb(), id);
  if (!detail) notFound();

  const { turnover: t, derived } = detail;
  const holders = detail.steps
    .filter((s) => s.active)
    .map((s) => detail.people.find((p) => p.id === s.step.assigneeId)?.name ?? "nobody yet");
  const facts: Array<[string, string, string?]> = [
    ["Move-out", formatMonthDay(t.moveOutDate) || "Not set"],
    ["Target ready", formatMonthDay(t.targetReadyDate) || "Not set", detail.pastTarget ? "text-danger" : undefined],
    ["Days vacant", derived.daysVacant === null ? "–" : String(derived.daysVacant)],
    ["Days in stage", derived.daysInStage === null ? "–" : String(derived.daysInStage)],
  ];

  return (
    <TurnoverProvider turnoverId={t.id} version={t.version}>
      <AutoRefresh seconds={15} />
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {detail.propertyName} {t.unit}
            <FlagPill flag={derived.flag} pastTarget={detail.pastTarget} className="text-sm" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {derived.isComplete
              ? "Complete: rent-ready and listed."
              : `${derived.currentStage}${holders.length ? ` · with ${holders.join(" and ")}` : ""}`}
          </p>
        </div>
        <EditDetails moveOutDate={t.moveOutDate} targetReadyDate={t.targetReadyDate} notes={t.notes} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border border-border bg-card px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</dd>
          </div>
        ))}
      </dl>

      {t.notes ? (
        <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="font-medium">Notes / blockers: </span>
          {t.notes}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-label="Steps" className="space-y-3">
          {detail.steps.map((s) => (
            <StepCard
              key={s.step.id}
              detail={s}
              people={detail.people}
              today={detail.today}
              turnoverId={t.id}
              findings={detail.findings.filter((f) => f.stepId === s.step.id)}
              attachments={detail.attachments}
            />
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            Workflow: {detail.templateName}. Created {formatDateTime(detail.createdAt, detail.settings.timezone)}
            {detail.createdByName ? ` by ${detail.createdByName}` : ""}
            {detail.importSource ? `, imported from row ${detail.importSource.rowNumber} of ${detail.importSource.file}` : ""}.
          </p>
        </section>

        <aside>
          <Card>
            <CardHeader title="Timeline" description="Every change, who made it and when." />
            <div className="border-b border-border px-4 py-3">
              <NoteForm />
            </div>
            <Timeline entries={detail.timeline} timeZone={detail.settings.timezone} />
          </Card>
        </aside>
      </div>
    </TurnoverProvider>
  );
}
