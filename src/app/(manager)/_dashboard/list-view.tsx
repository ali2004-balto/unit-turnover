import Link from "next/link";
import { FlagPill, StatusPill } from "@/components/status";
import { formatBooking, formatMonthDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CardView } from "@/server/queries/dashboard";
import { UnitCard } from "./unit-card";

export function ListView({ cards }: { cards: CardView[]; today: string }) {
  return (
    <>
      {/* Phones get cards; wider screens get a table. */}
      <div className="flex flex-col gap-2 md:hidden">
        {cards.map((card) => (
          <UnitCard key={card.id} card={card} showStage />
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Current stage</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Assigned to</th>
              <th className="px-3 py-2 text-right font-medium">Days vacant</th>
              <th className="px-3 py-2 text-right font-medium">Days in stage</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Flag</th>
              <th className="px-3 py-2 font-medium">Blockers and notes</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/turnovers/${card.id}`} className="font-medium hover:underline">
                    {card.propertyName} {card.unit}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{card.currentStage}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {card.activeSteps.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <StatusPill status={s.status} />
                        {s.status === "scheduled" && s.scheduledOn ? (
                          <span className="text-xs text-muted-foreground">{formatBooking(s.scheduledOn, s.scheduledTime)}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {card.activeSteps.map((s) => (
                    <div key={s.id} className={cn(!s.assigneeName && "font-medium text-danger")}>
                      {s.assigneeName ?? "Needs assignee"}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{card.daysVacant ?? ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{card.daysInStage ?? ""}</td>
                <td className={cn("px-3 py-2 whitespace-nowrap", card.pastTarget && "text-danger")}>
                  {formatMonthDay(card.targetReadyDate)}
                </td>
                <td className="px-3 py-2">
                  <FlagPill flag={card.flag} pastTarget={card.pastTarget} />
                </td>
                <td className="max-w-80 px-3 py-2 text-xs">
                  {card.blockers.map((b) => (
                    <p key={b.stepName} className="font-medium text-st-blocked-fg">
                      Blocked at {b.stepName}: {b.reason}
                    </p>
                  ))}
                  {card.notes ? <p className="line-clamp-2 text-muted-foreground">{card.notes}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
