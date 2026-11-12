import type { TvBoard } from "@/server/queries/tv-board";
import { fit } from "@/domain/tv-board";
import { formatDays } from "@/lib/format";
import styles from "./board.module.css";

/** What fits on a 1920x1080 screen without scrolling. */
const MAX_TURNS = 12;
const MAX_NEEDS = 6;
const MAX_DONE = 6;

const FLAG_CLASS: Record<string, string> = {
  Overdue: styles.overdue,
  Blocked: styles.blocked,
  "Due soon": styles.soon,
  "On track": styles.ok,
  "No target date": styles.none,
  Complete: styles.ok,
};

const clock = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);

const when = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);

function More({ n }: { n: number }) {
  return n > 0 ? <div className={styles.more}>+{n} more</div> : null;
}

function Placeholder({ title }: { title: string }) {
  return (
    <section className={`${styles.panel} ${styles.quiet}`}>
      <h2>{title}</h2>
      <p>Connects in a later step</p>
    </section>
  );
}

export function Board({ board }: { board: TvBoard }) {
  const { metrics: m, timezone } = board;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(board.now);
  const turns = fit(board.turns, MAX_TURNS);
  const needs = fit(board.needs, MAX_NEEDS);
  const done = fit(board.overnight, MAX_DONE);
  const tiles: Array<[string, string, string?]> = [
    ["Active turns", String(m.active)],
    ["Need you", String(m.needYou), m.needYou > 0 ? styles.warn : undefined],
    ["Overdue", String(m.overdue), m.overdue > 0 ? styles.bad : undefined],
    ["Avg days vacant", m.avgDaysVacant === null ? "–" : (Math.round(m.avgDaysVacant * 10) / 10).toString()],
    ["Finished, 30 days", String(m.finished30)],
    ["On time, 90 days", m.onTime90 === null ? "–" : `${Math.round(m.onTime90 * 100)}%`],
  ];

  return (
    <div className={styles.board}>
      <meta httpEquiv="refresh" content="300" />
      <header className={styles.header}>
        <h1>{date}</h1>
        <div className={styles.asof}>As of {clock(board.now, timezone)}</div>
      </header>

      <div className={styles.metrics}>
        {tiles.map(([label, value, tone]) => (
          <div key={label} className={styles.tile}>
            <div className={`${styles.value} ${tone ?? ""}`}>{value}</div>
            <div className={styles.label}>{label}</div>
          </div>
        ))}
      </div>

      <div className={styles.main}>
        <section className={`${styles.panel} ${styles.turnovers}`}>
          <h2>Turnovers</h2>
          <div className={styles.stages}>
            {board.stages.map((s) => (
              <div key={s.label} className={styles.stage}>
                <span className={styles.count}>{s.units}</span>
                <span className={styles.stageName}>{s.label}</span>
              </div>
            ))}
          </div>
          {board.turns.length === 0 ? <p className={styles.empty}>No active turnovers.</p> : null}
          <div className={styles.cards}>
            {turns.shown.map((t) => (
              <div key={t.id} className={`${styles.card} ${FLAG_CLASS[t.flag] ?? ""}`}>
                <div className={styles.cardTitle}>{t.label}</div>
                <div className={styles.cardStage}>{t.stage}</div>
                <div className={styles.cardMeta}>
                  {t.who} · {t.daysInStage === null ? "–" : formatDays(t.daysInStage)} in stage
                </div>
                <div className={styles.flag}>{t.flag}</div>
              </div>
            ))}
          </div>
          <More n={turns.more} />
        </section>

        <div className={styles.side}>
          <section className={`${styles.panel} ${styles.sidePanel}`}>
            <h2>Needs you</h2>
            {board.needs.length === 0 ? <p className={styles.empty}>Nothing needs you.</p> : null}
            {needs.shown.map((n) => (
              <div key={n.id} className={`${styles.row} ${FLAG_CLASS[n.flag] ?? ""}`}>
                <div className={styles.rowMain}>{n.label}</div>
                <div className={styles.rowSub}>
                  {n.yourSteps.length > 0 ? `Your step: ${n.yourSteps.join(", ")}` : n.flag}
                  {n.yourSteps.length > 0 && (n.flag === "Overdue" || n.flag === "Blocked") ? ` · ${n.flag}` : ""}
                </div>
              </div>
            ))}
            <More n={needs.more} />
          </section>

          <section className={`${styles.panel} ${styles.sidePanel}`}>
            <h2>Done overnight</h2>
            {board.overnight.length === 0 ? <p className={styles.empty}>Nothing since 6 pm yesterday.</p> : null}
            {done.shown.map((d) => (
              <div key={d.id} className={`${styles.row} ${styles.ok}`}>
                <div className={styles.rowMain}>
                  {d.what} · {d.label}
                </div>
                <div className={styles.rowSub}>
                  {d.who ? `${d.who} · ` : ""}
                  {when(d.at, timezone)}
                </div>
              </div>
            ))}
            <More n={done.more} />
          </section>
        </div>
      </div>

      <div className={styles.footer}>
        <Placeholder title="Today" />
        <Placeholder title="Projects" />
        <Placeholder title="Email and deadlines" />
      </div>
    </div>
  );
}
