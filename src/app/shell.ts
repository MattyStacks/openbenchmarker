import { $ } from "./dom";

export type View = "home" | "run" | "results" | "history" | "shared";

/** True while a run owns the page: routing is ignored until it ends. */
export const app = { running: false };

const TITLES: Record<View, string> = {
  home: "Open GPU Benchmarker: Free Browser GPU Benchmark",
  run: "Running Neon Flythrough · Open GPU Benchmarker",
  results: "Result · Open GPU Benchmarker",
  history: "My Results · Open GPU Benchmarker",
  shared: "Shared result · Open GPU Benchmarker",
};

export function showView(v: View): void {
  for (const id of ["home", "run", "results", "history", "shared"]) $(`#view-${id}`).hidden = id !== v;
  document.title = TITLES[v];
  document.body.dataset.view = v;
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === v;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
