import "./style.css";
import { kanaRenders } from "./app/dom";
import { buildConfigForm } from "./app/home";
import { route } from "./app/router";
import { bindStageMessage } from "./app/run";

if (import.meta.env.DEV && new URLSearchParams(location.search).has("capture")) {
  void import("./app/capture").then((m) => m.runCapture());
} else {
  if (!kanaRenders()) document.documentElement.classList.add("no-kana");
  window.addEventListener("hashchange", route);
  bindStageMessage();
  buildConfigForm();
  if (location.hash === "#/run") location.hash = "#/";
  route();
}
