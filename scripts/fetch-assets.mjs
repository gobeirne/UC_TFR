// Copies MediaPipe WASM from node_modules and downloads the Face Landmarker model
// into public/, so the deployed app is self-contained and works offline.
import { copyFileSync, mkdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const wasmSrc = "node_modules/@mediapipe/tasks-vision/wasm";
const wasmDst = "public/wasm";
mkdirSync(wasmDst, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  copyFileSync(join(wasmSrc, f), join(wasmDst, f));
  console.log(`copied ${f}`);
}

const modelPath = "public/models/face_landmarker.task";
mkdirSync("public/models", { recursive: true });
if (existsSync(modelPath) && statSync(modelPath).size > 1_000_000) {
  console.log("model already present");
} else {
  console.log("downloading face_landmarker.task …");
  const r = await fetch(MODEL_URL);
  if (!r.ok) { console.error(`model download failed: ${r.status}`); process.exit(1); }
  writeFileSync(modelPath, Buffer.from(await r.arrayBuffer()));
  console.log(`saved ${modelPath} (${(statSync(modelPath).size / 1e6).toFixed(1)} MB)`);
}
