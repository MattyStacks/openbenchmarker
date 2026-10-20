import { renderHistory } from "./history-view";
import { renderResults } from "./results-view";
import { app, showView } from "./shell";
import { findResult } from "./store";

export function route(): void {
  if (app.running) return;
  const h = location.hash;
  const m = h.match(/^#\/result\/(.+)$/);
  if (m) {
    const r = findResult(decodeURIComponent(m[1]));
    if (r) return renderResults(r);
  }
  if (h === "#/history") return renderHistory();
  showView("home");
}
