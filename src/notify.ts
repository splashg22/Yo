/**
 * Optional alerts to Discord and/or Telegram. Alerts are a convenience: a
 * failed alert is logged and never stops or changes a cycle.
 */
import { formatUnits } from "./amounts.js";
import type { LiveReport } from "./cycle.js";

export interface NotifyConfig {
  discordWebhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

export function formatCycleMessage(
  report: Pick<LiveReport, "cycle" | "claimed" | "swapped" | "burned" | "boughtBack" | "selfBurned" | "paid" | "recipients" | "skipped" | "notes">,
  units: { quoteDecimals: number; burnDecimals: number; strategyDecimals?: number },
  siteUrl: string | null = null,
): string | null {
  const active = report.claimed > 0n || report.swapped > 0n || report.burned > 0n || report.boughtBack > 0n || report.selfBurned > 0n || report.paid > 0n;
  const trouble = report.skipped.length > 0 || report.notes.some((n) => /failed|expired|queued/.test(n));
  if (!active && !trouble) return null; // quiet cycles send nothing
  const lines = [`Cycle ${report.cycle}`];
  if (report.claimed > 0n) lines.push(`Claimed ${formatUnits(report.claimed, units.quoteDecimals)} TTWO`);
  if (report.burned > 0n) lines.push(`Burned ${formatUnits(report.burned, units.burnDecimals)} DCTY (spent ${formatUnits(report.swapped, units.quoteDecimals)} TTWO)`);
  if (report.selfBurned > 0n) lines.push(`Bought back and burned ${formatUnits(report.selfBurned, units.strategyDecimals ?? 6)} of the coin (spent ${formatUnits(report.boughtBack, units.quoteDecimals)} TTWO)`);
  if (report.paid > 0n) lines.push(`Paid ${formatUnits(report.paid, units.quoteDecimals)} TTWO to ${report.recipients} holders`);
  if (report.skipped.length > 0) lines.push(`${report.skipped.length} payout(s) could not be delivered and went back to the pool`);
  for (const note of report.notes.filter((n) => /failed|expired|queued/.test(n))) lines.push(`Note: ${note}`);
  if (siteUrl && active) lines.push(`Dashboard: ${siteUrl.replace(/\/$/, "")}/dashboard.html`);
  return lines.join("\n");
}

export class Notifier {
  private lastError: string | null = null;

  constructor(
    private readonly config: NotifyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: (message: string) => void = () => {},
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.discordWebhookUrl || (this.config.telegramBotToken && this.config.telegramChatId));
  }

  async send(text: string): Promise<void> {
    const { discordWebhookUrl, telegramBotToken, telegramChatId } = this.config;
    const post = async (name: string, url: string, body: unknown) => {
      try {
        const response = await this.fetchImpl(url, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        if (!response.ok) this.log(`${name} alert was refused (HTTP ${response.status})`);
      } catch (error) {
        this.log(`${name} alert could not be sent: ${(error as Error).message}`);
      }
    };
    if (discordWebhookUrl) await post("Discord", discordWebhookUrl, { content: text.slice(0, 1900) });
    if (telegramBotToken && telegramChatId) {
      await post("Telegram", `https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        chat_id: telegramChatId, text: text.slice(0, 4000), disable_web_page_preview: true,
      });
    }
  }

  /** The same error every few minutes is sent once, then again when it changes. */
  async error(message: string): Promise<void> {
    if (message === this.lastError) return;
    this.lastError = message;
    await this.send(`Problem: ${message}`);
  }

  clearError(): void {
    this.lastError = null;
  }
}
