import "./style.css";
import { kanaRenders } from "./app/dom";
import { buildConfigForm } from "./app/home";
import { route } from "./app/router";
import { bindStageMessage } from "./app/run";
import { endRun, takeLeftoverRun } from "./app/run-guard";

if (import.meta.env.DEV && new URLSearchParams(location.search).has("capture")) {
  void import("./app/capture").then((m) => m.runCapture());
} else if (import.meta.env.DEV && new URLSearchParams(location.search).has("lab")) {
  void import("./app/lab").then((m) => m.runLab());
} else {
  if (!kanaRenders()) document.documentElement.classList.add("no-kana");
  window.addEventListener("hashchange", route);
  bindStageMessage();
  buildConfigForm(takeLeftoverRun());
  // A normal close or reload (even mid-build) is not a crash. An OS memory kill fires no event, so its record stays.
  window.addEventListener("pagehide", () => endRun());
  if (location.hash === "#/run") location.hash = "#/";
  route();
}
