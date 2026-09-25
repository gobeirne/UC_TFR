# Touch-free audiometry response

An experimental touch-free patient-response interface for behavioural audiometry.

The device sits 30–60° to one side of the client. The client looks straight ahead, and whenever they hear a beep they look at the device. While they do, its screen turns **green**; otherwise it is **black**. The clinician records the response exactly as they would a button press.

It is not a diagnostic system, not an eye-tracking medical device, not a validated replacement for a patient response button, and not certified medical equipment. It does not determine hearing threshold.

It runs entirely in the browser: iPhone/iPad Safari, Android Chrome, and desktop Chrome/Edge/Safari/Firefox with a webcam. One codebase, no app store, no account, no server of its own.

Optionally, a second device can be paired as a **clinician remote** (using the RapidPair component from UC KTT): it shows the response without line of sight to the client's screen, and lets the clinician recalibrate, start and pause testing, and change detection mode from where they sit.

---

## Quick start

```bash
npm install          # also copies MediaPipe WASM and downloads the face model into public/
npm run dev          # http://localhost:5173 on this computer (webcam)
npm test             # classifier, state machine, output manager, geometry tests
npm run simulate     # prints the synthetic score sequence through the state machine
npm run build        # static site in dist/
```

If `npm install` could not download the model (offline, proxy), run `npm run setup` later. Without the bundled model the app falls back to downloading it from Google at runtime and will not work offline.

### Testing on a phone during development

Phone browsers only allow the camera over HTTPS. Either:

- `npm run dev:https`, then open `https://<your-computer's-LAN-IP>:5173` on the phone and accept the self-signed certificate warning (Safari: *Show Details › visit this website*); or
- deploy to a static HTTPS host (below) and test there — usually simpler for iPhone.

### Trying the flow with no camera or face

`npm run dev`, then open `http://localhost:5173/?sim`. Tracking is replaced by a synthetic client: **hold Space** to “look at the device”, **← / →** to shift their resting posture, **hold L** to simulate lost tracking. Add `&loopback` in one tab and `?loopback` in another to pair them as patient device and clinician remote without RapidPair. Development builds only; both are stripped from production.

---

## Deploying (static HTTPS hosting)

There is no application server. `dist/` is the whole app. `base` is relative, so it works at a domain root or a sub-path.

**GitHub Pages:** push to `main`; `.github/workflows/deploy.yml` installs, fetches the model, runs the tests, builds and publishes. In the repository, set *Settings › Pages › Source* to *GitHub Actions*.

**Netlify / Cloudflare Pages:** build command `npm run setup && npm run build`, output directory `dist`.

**University or other web hosting:** run `npm run setup && npm run build` locally and upload the contents of `dist/`. Serve `.wasm` as `application/wasm` and don't long-cache `sw.js`.

---

## Using it

1. Open the site. Optionally install it (below).
2. **Start new session** → allow camera access.
3. **Position:** place the device so the face is clearly visible while the client looks ahead. Either side, 30–60°, near eye level.
4. **Calibrate:** tap *Record forward position* while the client looks ahead (about 2 s), then *Record response position* while they look at the device.
5. **Result:** Excellent / Good / Marginal / Unable to distinguish, with suggestions. Marginal or worse is never silently accepted.
6. **Try it:** the client looks forward and at the device a few times; the circle should go green once per look.
7. **Start testing:** the screen goes black. Green = responding.
8. **To leave the black screen:** tap the small **‹ Back** button in the top-left corner, press **Esc** on a keyboard (or leave full screen any other way), or press and hold the top-left corner for 1.5 s. The pause screen shows response count, time without tracking, any “device may have moved” warning, and research-log export.

### Installing as a web app (optional)

- **iPhone/iPad:** in Safari, tap Share (or the page menu) › *Add to Home Screen*, and switch on *Open as Web App* if offered.
- **Android:** Chrome menu › *Install app* / *Add to Home screen*.
- **Desktop:** Chrome/Edge install icon in the address bar.

The ordinary website works just as well. After one complete session everything needed is cached, so no connection is required in the clinic.

---

## Detection modes

Chosen in Settings, on the try-out and calibration-result screens, or from the clinician remote. All four are computed on every frame; the developer graph shows them side by side.

| Mode | How it decides | Best for | Weak spot |
|---|---|---|---|
| **Fixed calibration** | Distance along the line from the recorded forward position to the recorded response position | Clients who can hold a steady posture | A sustained change of posture shifts the baseline — worst when detection relies mainly on head movement (e.g. glasses hide the eyes) |
| **Adaptive baseline** (default) | As fixed, but the forward position slowly follows gradual drift (20 s time constant) | Slumping, settling, slow leaning | Only frames that already look like "forward" teach it; sudden movements and long looks elsewhere are ignored. Movement toward the response direction is capped at half the calibrated distance, with a "consider recalibrating" warning |
| **Eye contact** | Estimated angle between the client's gaze and the camera: head direction (measured relative to the face→camera line, so it survives the client moving in their seat) plus the model's eye-rotation estimate | Clients whose posture changes a lot, including involuntary movement | Needs good lighting on the face; noisier with glasses; needs the device ≥ ~8° from forward gaze (30–60° recommended) |
| **Cautious (both agree)** | A response needs both adaptive and eye contact to agree | Minimising false responses | May miss weak or partial looks |

Eye contact learns three numbers per person: what "looking at the device" measures (bias), how far forward gaze is from the device, and how much eye rotation counts relative to head rotation. The last is a prior (40°/unit) unless you **add another response posture**: ask the client to sit a little differently and look at the device again. Two or more postures let it be fitted from the data.

All modes share the same thresholds, dwell times and state machine, and the same safety rules.

Spasm handling applies in every mode: activation needs the score held for the activation dwell (150 ms default; raise it in developer mode for clients with brief involuntary movements). Blinks and momentary tracking gaps up to 300 ms neither start nor end a response; the camera or app stopping ends a response immediately.

## Clinician remote (optional second device)

1. On the device facing the client: **Start new session** and get to the position screen.
2. On the clinician's device (phone, tablet or laptop), open the same web address and tap **Use this device as the clinician remote**. It shows a connection code.
3. On the client's device, tap **Pair clinician remote** and enter the code (or use *LAN QR code* when there's no internet — both devices on the same Wi-Fi). Confirm the matching verification codes on both.

The client's device releases its camera while the pairing dialog is open (the QR option uses the camera; iPhones can't share it) and restarts it afterwards.

From the remote you can:
- **See responses:** a large lamp mirrors the client's screen, with a response counter.
- **Recalibrate at any time:** ask the client to look ahead and tap *Record forward position*; ask them to look at the device and tap *Record response position*. Either can be refreshed on its own, even mid-test. The client's screen stays black while recording and nothing counts as a response. A new calibration is applied automatically only if it grades Good or Excellent for the current mode; otherwise the previous one stays in use and you're told why (a Marginal one can be applied deliberately, with confirmation).
- **Add another response posture** (eye-contact and cautious modes).
- **Start and pause testing**, change detection mode, and restart tracking on the client's device.

If the link drops, or the remote hears nothing for 1.5 s, the lamp turns **grey and hatched with "No signal"**. It never shows black, so a lost link can't be mistaken for "no response". The client's device keeps working on its own screen regardless. After a disconnect, the client's device does not pop the pairing dialog up in front of the client; re-pair from it when convenient.

## Privacy

- All tracking runs in the page (MediaPipe Face Landmarker, WebAssembly, on this device).
- **Pairing (optional)** sends only response events, scores, tracking state and commands between the two devices, over RapidPair's end-to-end encrypted, code-verified channel. Never video, images, landmarks or face measurements. Setting up a code-based pairing uses the UC pairing Firebase project (to exchange connection details) and, if the network needs it, a Cloudflare TURN relay (which carries only encrypted data). The LAN QR option uses neither. Nothing is contacted until someone taps a pairing button.
- Video frames are never uploaded, transmitted, recorded, stored or cached. The service worker only caches the app's own files and the model.
- Camera only; the microphone is never requested.
- No login, patient identity, analytics or telemetry. Only preferences are saved (localStorage).
- Calibration and the optional research log live in memory and are discarded when the session ends unless the clinician exports the CSV. The log contains numbers and timestamps only.

---

## How detection works

The question is never “where on the screen are they looking?”; it is “has this person moved from *their* forward orientation to *their* response orientation?”

**Features** (`src/tracking/FeatureExtractor.ts`). Each frame becomes a small, interpretable vector:

| Group | Features |
|---|---|
| Head | yaw, pitch, roll from the model's 3-D face transform; nose position relative to the face outline (geometric fallback) |
| Eyes | iris position within each eye, measured along and across the eye-corner line (roll- and resolution-independent) |
| Eyes (model) | MediaPipe's gaze blendshapes (look-in/out/up/down) per eye |

Eye features are dropped for a frame while that eye blinks. All landmark indices live in `src/tracking/landmarks.ts`.

**Calibration** (`src/calibration/CalibrationModel.ts`). Two ~1.8 s recordings (after a 0.3 s settle) give per-feature means and SDs for F (forward) and R (response), with transient outliers removed. Each feature is standardised by its within-state SD (floored, so no single suspiciously quiet feature dominates). Features that don't differ consistently, or are often missing, get zero weight. The system therefore adapts to whoever is in front of it: head turners, eye movers, or both. Device side and sign conventions don't matter, because direction comes from R − F.

**Score.** A diagonal Fisher discriminant projected onto the F→R line: `score = z·dz / |dz|²`, where `z = (x − F)/sd` and `dz = (R − F)/sd`. So 0 ≈ forward, 1 ≈ response. If a feature disappears at runtime (e.g. glasses glare hides an iris) the rest carry on; if too little of the discriminant is available the frame counts as *not tracking*.

**Off-axis gate** (an addition to the original spec). The score alone would rate “looking down at the lap” or “turning to the clinician” by how much it happens to overlap with the F→R direction. The classifier also measures distance from the F→R line; movements far off it cannot trigger a response. It's widened automatically if calibration was noisy, and can be disabled in developer mode (gate = 0).

**Quality.** Calibration frames are projected; d′ = 1 / pooled SD of their scores. Grades (Excellent ≥ 10, Good ≥ 6, Marginal ≥ 3.5, plus tracked-frame fractions) are initial guesses in `src/config/defaults.ts`.

**State machine** (`src/detection/ResponseStateMachine.ts`). `TRACKING_LOST → FORWARD_ARMED → RESPONSE_CANDIDATE → RESPONSE_ACTIVE → RELEASE_CANDIDATE`. Activation ≥ 0.70 for 150 ms; release ≤ 0.35 for 200 ms (hysteresis). One look = one response; tremor near the response position cannot retrigger. Missing data never produces a response, cancels an active one, and the system rearms only after a sustained valid forward period. It also starts unarmed, so the client must be looking forward first.

**Outputs** (`src/outputs/`). The detector emits generic `response-on` / `response-off` events with timestamps to an `OutputManager`. The black/green screen is just one `ResponseOutput`. A WebSocket, Bluetooth or hardware-bridge output can be added as another class without touching tracking, calibration, classification or the state machine. A failing output cannot affect the detector or other outputs.

```
camera → MediaPipe (in page) → features → personal calibration → classifier + gate
       → state machine → RESPONSE_ON/OFF → OutputManager → [visual] [research log] [future: network, BLE, bridge]
```

---

## Device capabilities and fallbacks

| Capability | Used for | If missing |
|---|---|---|
| HTTPS + camera API | required | clear error |
| WebAssembly | required (MediaPipe) | clear error |
| WebGL | GPU inference | CPU (automatic; also auto-fallback if GPU errors at runtime) |
| `requestVideoFrameCallback` | frame-driven inference | `requestAnimationFrame` with frame de-duplication (also used if frame callbacks stall) |
| Screen Wake Lock | keep screen on in test mode | warning before testing; re-acquired after the app returns to view |
| Fullscreen API | hide browser chrome (Android, desktop, iPad) | page still fills the screen (iPhone) |
| Service worker | offline use | works online only |
| Web Bluetooth / Serial / USB | reported only, for future outputs | no effect |

Inference runs throttled at 20 Hz by default (adjustable), with 720p capture for iris detail. Developer mode shows actual inference time, rate, camera fps, loop type and skipped frames.

---

## Developer mode

*Settings › Developer mode.* Adds: landmark overlay (eye corners, iris centres, nose, face outline), live and calibrated feature table with separation, noise and weight (“what is the system actually using?”), a scrolling score graph with thresholds and ON/OFF markers, live sliders for thresholds, dwell, gate and inference rate, performance stats, a synthetic state-machine run, and a research override for Marginal calibrations (behind an explicit confirmation). An optional demo beep is clearly labelled *Developer demonstration only — not a calibrated audiometric stimulus*, and never plays in test mode.

**Research logging** (off by default): event CSV (`sessionTimeMs,event,responseScore,trackingValid,frameTimeMs,fromState,toState`) and optional per-sample feature CSV, with frame and classification timestamps logged separately so latency can be characterised later. Anonymous participant code only.

---

## Diagnostics

*Home › Diagnostics*, or the Diagnostics button on the position screen. It shows, live, every step from camera to tracker:
- camera stream state;
- video element state and any `play()` error;
- new frames per second;
- frame brightness, which catches black frames;
- tracker configuration, model and engine;
- inference rate and errors;
- what happened to recent frames (face / no face / edge / error);
- the last tracker error and the recovery log.

It shows both the camera preview and "what the tracker receives".

The **tracker self-test** runs a few seconds each of GPU and CPU processing, with and without the app-supplied canvas, and with the live video or a copied still frame. It reports which setups find a face and offers **Use this setup**. The choice is saved on the device. It can also be set by hand in *Settings › Tracking*.

**Copy report** or **Share report** produces a plain-text summary: no images, no identifiers beyond the browser's user-agent string.

## Troubleshooting: “Face detected: No” although the face is in view

Run Diagnostics first. Since 0.2.2, iPhones and iPads use the tracker's own canvas by default, which was the configuration in 0.1.0. Tapping the screen resumes a camera picture the browser has paused.

iPhones in particular switch off the camera and discard the tracker's graphics memory when the app goes to the background, the screen locks, or another app uses the camera. Since 0.1.1 the app handles this itself:

- Leaving the app turns the camera off. Returning restarts the camera and rebuilds the tracker. Calibration is kept.
- It also restarts automatically if the camera stops delivering images, if the tracker's graphics context is lost, after repeated tracker errors (switching GPU → CPU if needed), or if a face disappears for 6 s while images keep arriving.
- Every new session starts with a fresh tracker.
- The position and try-out screens say *why* tracking failed, and offer **Restart camera and tracking**.
- While restarting, the screen stays black and nothing counts as a response. In test mode the client must look forward before responses count again.

If problems persist, try *Settings › Processor › CPU*.

Since 0.2.1, recovery escalates gently and can't loop:
- **Paused video.** If the browser pauses the video (iOS does this to videos it thinks are hidden), it is simply resumed, with no new camera request.
- **Brief system mute.** A system "mute" is given 2 s to clear by itself.
- **Camera actually stopped.** Only then is the camera restarted, at most 3 times a minute. After that, automatic restarts stop and the app says so, with a manual restart button.

Every recovery is logged with its reason. Developer mode lists them under "Camera / tracking recovery log", and a paired remote shows a warning when restarts repeat.

## Current limitations

- **Detection modes and the remote are tested only against synthetic data** (unit tests and a simulated client in two paired browser tabs), not yet against real faces. The eye-contact model's accuracy with real MediaPipe gaze estimates, glasses and poor lighting is the key unknown. Use developer mode's comparison graph with real clients before relying on it.
- Code-based pairing depends on the same Firebase project and TURN credential service as KTT. If pairing from this app's address fails but KTT works, check whether the Firebase API key or the TURN worker restricts which websites may use them. LAN QR pairing doesn't need either.
- Reconnecting after a dropped link needs a new code entered on the client's device (KTT's saved-secret "fast reconnect" isn't ported yet).

- **Not yet validated on real clients.** Thresholds, dwell times, quality grades and the gate are reasoned starting points, checked with synthetic data and unit tests, not clinical data. The immediate next step is the informal robustness test: left vs right placement, glasses, eye-only vs head movement, lighting, several phones.
- Built and tested in desktop Chromium with a simulated tracker and fake camera. The real MediaPipe path compiles and the loading and error paths were exercised, but it has not yet been run against a real face on an iPhone. Expect to tune on-device.
- Movement detection is heuristic (face position/size drift while looking forward, and screen orientation changes). It warns; it never recalibrates.
- One face is tracked. A second person entering the frame is not explicitly detected; MediaPipe keeps following the most prominent face. Keep the client the only face in view.
- iPhone Safari does not allow true fullscreen for web pages; the black/green area fills the viewport, and an installed Home Screen app gives the cleanest result.
- Screen brightness cannot be controlled from the web; set it manually.
- Main-thread inference. Move it to a Worker only if on-device measurements show UI stalls.
- Offline use needs one complete session online first (or waiting for the service worker install) so everything is cached.

## Source map

```
src/
  config/        defaults.ts (every tunable), settings.ts (preferences only)
  camera/        CameraManager.ts
  tracking/      TrackingSample.ts, landmarks.ts, FeatureExtractor.ts, MediaPipeFaceTracker.ts, TrackingEngine.ts
  calibration/   CalibrationModel.ts, CalibrationQuality.ts, EyeContactModel.ts, CalibrationService.ts
  detection/     ResponseClassifier.ts, ResponseStateMachine.ts, ResponsePipeline.ts (+ movement monitor), DriftTracker.ts
  outputs/       ResponseOutput.ts, OutputManager.ts, VisualOutput.ts, PairedOutput.ts
  pairing/       protocol.ts, PairLink.ts, RapidPairLink.ts (wraps vendor/rapidpair.js), LoopbackLink.ts (dev), PairingManager.ts
  logging/       SessionLogger.ts, CsvExporter.ts
  platform/      capabilities, wake lock, fullscreen, dev beep
  ui/            one file per screen, plus preview, score graph, feature table
  dev/           simulator.ts (dev builds only)
  sw-template.js service worker (precache list injected at build)
tests/           unit tests + synthetic simulation
scripts/         fetch-assets.mjs (WASM copy + model download)
public/vendor/   rapidpair.js and its QR/compression libraries, copied unchanged from UCKTT v2 (loaded only when pairing is used)
```
