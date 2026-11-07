import type { ScheduleTriggerPlan } from "./plan";

export interface SlotCalendar {
  slotsBetween(fromMs: number, toMs: number, limit: number): readonly number[];
  nextAfter(ms: number): number;
  latestAtOrBefore?(ms: number): number;
}
export interface CronFields {
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
  readonly anyDay: boolean;
  readonly anyWeekday: boolean;
}
function field(raw: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid cron field: ${raw}`);
    const step = Number(match[2] ?? 1);
    const range = match[1] === "*" ? [min, max] : match[1].split("-").map(Number);
    const start = range[0];
    const end = range[1] ?? (match[2] ? max : start);
    if (step < 1 || start < min || end > max || start > end) throw new Error(`Invalid cron range: ${raw}`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron requires five fields");
  const weekday = field(parts[4], 0, 7);
  if (weekday.delete(7)) weekday.add(0);
  return {
    minute: field(parts[0], 0, 59),
    hour: field(parts[1], 0, 23),
    dayOfMonth: field(parts[2], 1, 31),
    month: field(parts[3], 1, 12),
    dayOfWeek: weekday,
    anyDay: parts[2] === "*",
    anyWeekday: parts[4] === "*",
  };
}
function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });
}
function matches(fields: CronFields, date: Date, format: Intl.DateTimeFormat): boolean {
  const parts = format.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const day = fields.dayOfMonth.has(Number(get("day")));
  const weekday = fields.dayOfWeek.has(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")));
  const dayMatches = fields.anyDay ? weekday : fields.anyWeekday ? day : day || weekday;
  return (
    fields.minute.has(Number(get("minute"))) &&
    fields.hour.has(Number(get("hour"))) &&
    fields.month.has(Number(get("month"))) &&
    dayMatches
  );
}
export function matchesCron(fields: CronFields, date: Date, timezone: string): boolean {
  return matches(fields, date, formatter(timezone));
}
export function createCalendar(calendar: ScheduleTriggerPlan["calendar"], armedAtMs: number): SlotCalendar {
  if ("everyMs" in calendar) {
    const every = calendar.everyMs;
    const nextAfter = (ms: number) => armedAtMs + (Math.floor((ms - armedAtMs) / every) + 1) * every;
    return {
      nextAfter,
      latestAtOrBefore: (ms) => armedAtMs + Math.floor((ms - armedAtMs) / every) * every,
      slotsBetween: (from, to, limit) => {
        const slots: number[] = [];
        for (let slot = nextAfter(from); slot <= to && slots.length < limit; slot += every) slots.push(slot);
        return slots;
      },
    };
  }
  const fields = parseCron(calendar.cron);
  const format = formatter(calendar.tz);
  const find = (ms: number, direction: 1 | -1) => {
    let candidate = Math.floor(ms / 60000) * 60000 + (direction === 1 ? 60000 : 0);
    for (let count = 0; count < 8 * 366 * 24 * 60; count++, candidate += direction * 60000) {
      if (matches(fields, new Date(candidate), format)) return candidate;
    }
    throw new Error("No cron slot within eight years");
  };
  return {
    nextAfter: (ms) => find(ms, 1),
    latestAtOrBefore: (ms) => find(ms, -1),
    slotsBetween: (from, to, limit) => {
      const slots: number[] = [];
      for (let slot = find(from, 1); slot <= to && slots.length < limit; slot = find(slot, 1)) slots.push(slot);
      return slots;
    },
  };
}
