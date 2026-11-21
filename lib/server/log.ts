/** Structured logs: one JSON object per line on stdout, so a host can search and count them. Never log inputs: they can hold signed requests. */
export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const floor = (): number => ORDER[(process.env.LOG_LEVEL as Level | undefined) ?? "info"] ?? 20;
/** Anything that looks like a key in a URL is removed before a line is written. */
const scrub = (text: string): string => text.replace(/(api-key=)[\w-]+/gi, "$1<hidden>");

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < floor() || process.env.LOG_SILENT === "1") return;
  const line = scrub(
    JSON.stringify({ at: new Date().toISOString(), level, message, ...fields }, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}
/** One line for a failure, with its cause, without its stack unless asked for. */
export function failure(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  return {
    error: error.message,
    ...(error.cause instanceof Error ? { cause: error.cause.message } : typeof error.cause === "string" ? { cause: error.cause } : {}),
    ...(process.env.LOG_STACKS === "1" ? { stack: error.stack } : {}),
  };
}
