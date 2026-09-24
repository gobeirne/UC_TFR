import type { Screen } from "./app";
import { h, fmt } from "./dom";
import { createPreview } from "./Preview";
import { ScoreGraph } from "./ScoreGraph";
import { ResponsePipeline } from "../detection/ResponsePipeline";
import { ResponseStateMachine } from "../detection/ResponseStateMachine";
import { featureTable } from "./featureTable";
import { scoreBar, startTesting } from "./ValidationScreen";
import { resetTunables } from "../config/settings";
import { devBeep } from "../platform/devBeep";
import { downloadText } from "../logging/CsvExporter";
import { FEATURE_INFO, FEATURE_KEYS } from "../tracking/TrackingSample";
import type { Settings } from "../config/defaults";

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export const DeveloperScreen: Screen = (app) => {
  const s = app.settings;
  const model = app.session?.calibration;
  const pipeline = model ? new ResponsePipeline(model, s) : undefined;
  const preview = createPreview(app, { landmarks: true, small: true });
  const graph = new ScoreGraph(s);
  const bar = scoreBar(app);
  const out = {
    state: h("span"), score: h("span"), off: h("span"), gate: h("span"), valid: h("span"), responses: h("span"),
    fps: h("span"), ms: h("span"), cam: h("span"), loop: h("span"), skipped: h("span"), latency: h("span"), moved: h("span"),
  };
  const liveBox = h("div");
  let lastLatency = 0, lastTableUpdate = 0;

  const unsub = app.engine.subscribe((smp) => {
    if (pipeline) {
      const t = pipeline.process(smp);
      graph.push(smp.timestampMs, t.c.score, t.c.valid, t.c.valid && !t.c.onAxis);
      for (const tr of t.transitions) if (tr.name === "response_on" || tr.name === "response_off") {
        graph.mark(tr.timestampMs, tr.name === "response_on");
        lastLatency = tr.timestampMs - smp.frameTimeMs;
      }
      bar.set(t.c.score, t.c.valid);
      out.state.textContent = pipeline.machine.state;
      out.score.textContent = t.c.valid ? fmt(t.c.score) : "—";
      out.off.textContent = t.c.valid ? fmt(t.c.offAxis) : "—";
      out.gate.textContent = fmt(pipeline.classifier.effectiveGate());
      out.responses.textContent = String(pipeline.responses);
      out.moved.textContent = pipeline.movement.moved ? pipeline.movement.reason : "no";
    }
    out.valid.textContent = smp.valid ? "valid" : `invalid: ${smp.invalidReason}`;
    const now = performance.now();
    if (now - lastTableUpdate > 250) {
      lastTableUpdate = now;
      const st = app.engine.stats();
      out.fps.textContent = `${st.inferenceFps} / target ${s.inferenceHz}`;
      out.ms.textContent = `${fmt(st.inferenceMsAvg, 1)} avg, ${fmt(st.inferenceMsMax, 1)} max (${st.delegate})`;
      out.cam.textContent = `${st.cameraFps} fps — ${app.camera.info}`;
      out.loop.textContent = `${st.loop}, errors ${st.errors}, recoveries ${st.recoveries}${st.lastRecovery ? ` (last: ${st.lastRecovery})` : ""}`;
      out.skipped.textContent = String(st.skippedFrames);
      out.latency.textContent = `${fmt(lastLatency, 1)} ms frame→transition (excl. dwell)`;
      liveBox.replaceChildren(model ? featureTable(model, smp.features)
        : h("table", { class: "features" }, ...FEATURE_KEYS.map((k) => h("tr", {}, h("td", {}, FEATURE_INFO[k].label), h("td", {}, fmt(smp.features[k], 3))))));
    }
  });

  const slider = (key: NumKey, label: string, min: number, max: number, step: number) => {
    const val = h("output", {}, String(s[key]));
    const input = h("input", { type: "range", min, max, step, value: s[key],
      oninput: (e: Event) => { (s as any)[key] = Number((e.target as HTMLInputElement).value); val.textContent = String(s[key]); app.saveSettings(); } });
    return h("label", { class: "slider" }, h("span", {}, label), input, val);
  };

  const synthOut = h("pre", { class: "synth" });
  const runSynthetic = () => {
    const seq = [0.05, 0.05, 0.05, 0.05, 0.05, 0.08, 0.12, 0.73, 0.78, 0.85, 0.91, 0.88, 0.40, 0.28, 0.12, 0.10, 0.08, 0.06, 0.05];
    const m = new ResponseStateMachine(() => s);
    const dt = 1000 / s.inferenceHz;
    synthOut.textContent = seq.map((v, i) => {
      const tr = m.update({ timestampMs: i * dt, valid: true, score: v });
      return `${String(Math.round(i * dt)).padStart(5)} ms  ${v.toFixed(2)}  ${m.state.padEnd(18)} ${tr.map((x) => x.name).join(", ")}`;
    }).join("\n");
  };

  const lg = app.session?.logger;
  app.root.append(h("main", { class: "page dev" },
    h("h1", {}, "Developer view"),
    model ? null : h("p", { class: "notice" }, "Not calibrated yet: showing raw features only."),
    h("div", { class: "dev-grid" },
      h("section", {}, preview.el,
        h("dl", { class: "readout small" },
          h("dt", {}, "Tracking"), h("dd", {}, out.valid),
          h("dt", {}, "Inference rate"), h("dd", {}, out.fps),
          h("dt", {}, "Inference time"), h("dd", {}, out.ms),
          h("dt", {}, "Camera"), h("dd", {}, out.cam),
          h("dt", {}, "Loop"), h("dd", {}, out.loop),
          h("dt", {}, "Skipped frames"), h("dd", {}, out.skipped),
          h("dt", {}, "Processing latency"), h("dd", {}, out.latency))),
      h("section", {},
        model ? h("div", {},
          bar.el, graph.el,
          h("p", { class: "legend" }, "White: score. Green dashes: activation. Amber dashes: release. Pink squares: off-axis (cannot activate). Red ticks: not tracking."),
          h("dl", { class: "readout small" },
            h("dt", {}, "State"), h("dd", {}, out.state),
            h("dt", {}, "Score"), h("dd", {}, out.score),
            h("dt", {}, "Off-axis / gate"), h("dd", {}, out.off, " / ", out.gate),
            h("dt", {}, "Responses"), h("dd", {}, out.responses),
            h("dt", {}, "Device moved?"), h("dd", {}, out.moved))) : null,
        h("div", { class: "sliders" },
          slider("activationThreshold", "Activation threshold", 0.3, 1.2, 0.05),
          slider("activationDwellMs", "Activation dwell (ms)", 0, 600, 25),
          slider("releaseThreshold", "Release threshold", -0.2, 0.7, 0.05),
          slider("releaseDwellMs", "Release dwell (ms)", 0, 800, 25),
          slider("offAxisGate", "Off-axis gate (0 = off)", 0, 3, 0.1),
          slider("inferenceHz", "Inference rate (Hz)", 5, 30, 1)),
        h("div", { class: "actions" },
          h("button", { onclick: () => { resetTunables(s); app.go("developer"); } }, "Reset defaults"),
          h("button", { onclick: () => app.go("calibrate-forward") }, "Recalibrate"),
          h("button", { onclick: () => void app.engine.restart() }, "Restart tracking"),
          model ? h("button", { onclick: () => app.go("validation") }, "Try-out screen") : h("button", { onclick: () => app.go("position") }, "Back"),
          model ? h("button", { class: "primary", onclick: () => startTesting(app) }, "Start testing") : null,
          s.devBeep ? h("button", { onclick: () => devBeep() }, "Demo beep") : null,
          lg ? h("button", { onclick: () => downloadText("events.csv", lg.eventsCsv()) }, "Export events CSV") : null),
        s.devBeep ? h("p", { class: "fineprint" }, "Demo beep: developer demonstration only — not a calibrated audiometric stimulus.") : null,
      )),
    h("h2", {}, model ? "Features (calibration and live)" : "Live features"), liveBox,
    h("details", {}, h("summary", {}, "Synthetic state-machine test"),
      h("button", { onclick: runSynthetic }, "Run synthetic sequence with current settings"), synthOut),
  ));
  return () => { unsub(); graph.dispose(); preview.dispose(); pipeline?.stop(performance.now()); };
};
