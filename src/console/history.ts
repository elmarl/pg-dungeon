import { escapeHtml } from "../html.js";

export interface HistoryPanel {
  add(who: string, sql: string): void;
}

export function createHistory(el: HTMLElement, limit = 60): HistoryPanel {
  const entries: Array<{ who: string; sql: string }> = [];

  return {
    add(who: string, sql: string): void {
      entries.unshift({ who, sql });
      entries.length = Math.min(entries.length, limit);
      el.innerHTML = entries
        .map(
          (entry) =>
            `<div class="${entry.who}"><span>${entry.who}</span>${escapeHtml(entry.sql)}</div>`,
        )
        .join("");
    },
  };
}
