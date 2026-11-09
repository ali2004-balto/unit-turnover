import { CalendarClock, OctagonAlert, Undo2, UserX } from "lucide-react";
import Link from "next/link";
import { FlagPill, StatusPill } from "@/components/status";
import { formatBooking, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CardView } from "@/server/queries/dashboard";

export function UnitCard({ card, showStage = false }: { card: CardView; showStage?: boolean }) {
  return (
    <Link
      href={`/turnovers/${card.id}`}
      className={cn(
        "block rounded-lg border border-border bg-card p-3 shadow-xs hover:border-primary/50",
        card.flag === "Overdue" && "border-l-4 border-l-fl-overdue-bg",
        card.flag === "Blocked" && "border-l-4 border-l-st-blocked-fg",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="font-semibold leading-tight">
          {card.propertyName} <span className="tabular-nums">{card.unit}</span>
        </p>
        {/* A target date in red already says "past target" on a card. */}
        <FlagPill flag={card.flag} />
      </div>
      {showStage ? <p className="mt-1 text-xs text-muted-foreground">{card.currentStage}</p> : null}

      <ul className="mt-2 space-y-1.5">
        {card.activeSteps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {card.activeSteps.length > 1 ? <span className="text-xs text-muted-foreground">{step.name}</span> : null}
            <StatusPill status={step.status} />
            {step.assigneeName ? (
              <span className="truncate">{step.assigneeName}</span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-danger">
                <UserX className="size-3.5" aria-hidden /> Needs assignee
              </span>
            )}
            {step.status === "scheduled" && step.scheduledOn ? (
              <span className={cn("text-xs", step.bookingPassed ? "font-medium text-danger" : "text-muted-foreground")}>
                {formatBooking(step.scheduledOn, step.scheduledTime)}
                {step.bookingPassed ? " (passed: did it happen?)" : ""}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <dl className="mt-2.5 grid grid-cols-3 gap-1 text-xs">
        <div>
          <dt className="text-muted-foreground">Vacant</dt>
          <dd className="font-medium tabular-nums">{card.daysVacant === null ? "–" : `${card.daysVacant}d`}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">In stage</dt>
          <dd className="font-medium tabular-nums">{card.daysInStage === null ? "–" : `${card.daysInStage}d`}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Target</dt>
          <dd className={cn("font-medium", card.pastTarget && "text-danger")}>{formatMonthDay(card.targetReadyDate) || "–"}</dd>
        </div>
      </dl>

      {card.blockers.map((b) => (
        <p key={b.stepName} className="mt-2 flex gap-1.5 rounded-md bg-st-blocked-bg px-2 py-1.5 text-xs text-st-blocked-fg">
          <OctagonAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Blocked: </span>
            {b.reason}
          </span>
        </p>
      ))}
      {card.upcomingBookings.map((b) => (
        <p key={b.stepName} className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          {b.stepName} booked {formatBooking(b.on, null)}
        </p>
      ))}
      {card.reworkCount > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <Undo2 className="size-3.5 shrink-0" aria-hidden />
          Sent back {card.reworkCount === 1 ? "once" : `${card.reworkCount} times`}
        </p>
      ) : null}
    </Link>
  );
}
