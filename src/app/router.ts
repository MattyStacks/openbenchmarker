import { renderHistory } from "./history-view";
import { renderResults } from "./results-view";
import { renderShared } from "./shared-view";
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
  const shared = h.match(/^#\/r\/(.+)$/);
  if (shared) return renderShared(shared[1]);
  if (h === "#/history") return renderHistory();
  showView("home");
}
