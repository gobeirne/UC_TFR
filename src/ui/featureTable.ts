import type { CalibrationModel } from "../calibration/CalibrationModel";
import type { FeatureVector } from "../tracking/TrackingSample";
import { h, fmt } from "./dom";

const level = (share: number, used: boolean) => (!used ? "zero" : share > 0.3 ? "high" : share > 0.1 ? "medium" : "low");

/** Developer table: per-feature separation, noise and weight. Optionally live values. */
export function featureTable(m: CalibrationModel, live?: FeatureVector): HTMLTableElement {
  const rows = [...m.weights].sort((a, b) => b.share - a.share || b.separation - a.separation);
  return h("table", { class: "features" },
    h("thead", {}, h("tr", {}, ...["Feature", "F", "R", ...(live ? ["Now"] : []), "Separation", "Noise (SD)", "Weight"].map((t) => h("th", {}, t)))),
    h("tbody", {}, ...rows.map((w) => h("tr", { class: w.used ? "" : "unused" },
      h("td", {}, w.label),
      h("td", {}, fmt(m.F.mean[w.key], 3)), h("td", {}, fmt(m.R.mean[w.key], 3)),
      ...(live ? [h("td", {}, fmt(live[w.key], 3))] : []),
      h("td", {}, w.rawSeparation > w.separation + 0.05 ? `${fmt(w.rawSeparation, 1)} (capped ${fmt(w.separation, 0)})` : fmt(w.rawSeparation, 1)), h("td", {}, fmt(w.pooledSd, 3)),
      h("td", {}, `${level(w.share, w.used)}${w.used ? ` (${Math.round(w.share * 100)}%)` : w.note ? ` — ${w.note}` : ""}`),
    ))),
  );
}
