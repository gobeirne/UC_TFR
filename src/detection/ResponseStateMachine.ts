/**
 * Response state machine with dwell, hysteresis, rearming and conservative
 * tracking-loss handling. Pure logic: no DOM, no timers, fully unit-testable.
 */
export type MachineState = "TRACKING_LOST" | "FORWARD_ARMED" | "RESPONSE_CANDIDATE" | "RESPONSE_ACTIVE" | "RELEASE_CANDIDATE";

export interface MachineParams {
  activationThreshold: number;
  activationDwellMs: number;
  releaseThreshold: number;
  releaseDwellMs: number;
}

export interface MachineInput {
  timestampMs: number;
  valid: boolean;
  score: number;
  /** If false the sample cannot contribute to activation (off-axis gate). */
  canActivate?: boolean;
}

export type TransitionName = "armed" | "candidate_on" | "candidate_cancel" | "response_on" | "candidate_off" | "release_cancel" | "response_off" | "tracking_lost";

export interface Transition {
  name: TransitionName;
  from: MachineState;
  to: MachineState;
  timestampMs: number;
  score: number;
  valid: boolean;
}

export class ResponseStateMachine {
  state: MachineState = "TRACKING_LOST"; // must see a clear forward state before arming
  private since = 0; // start time of current dwell
  private dwelling = false;

  constructor(private params: () => MachineParams) {}

  get active(): boolean {
    return this.state === "RESPONSE_ACTIVE" || this.state === "RELEASE_CANDIDATE";
  }

  reset(): void { this.state = "TRACKING_LOST"; this.dwelling = false; }

  /** Returns transitions in order. "response_on"/"response_off" are the only externally meaningful ones. */
  update(inp: MachineInput): Transition[] {
    const p = this.params();
    const out: Transition[] = [];
    const t = inp.timestampMs;
    const go = (to: MachineState, name: TransitionName) => {
      out.push({ name, from: this.state, to, timestampMs: t, score: inp.score, valid: inp.valid });
      this.state = to;
    };

    if (!inp.valid) {
      // Missing data never produces a response; an active response is cancelled.
      if (this.state !== "TRACKING_LOST") {
        if (this.active) go("TRACKING_LOST", "response_off");
        else go("TRACKING_LOST", "tracking_lost");
      }
      this.dwelling = false;
      return out;
    }

    const high = inp.score >= p.activationThreshold && inp.canActivate !== false;
    const low = inp.score <= p.releaseThreshold;

    switch (this.state) {
      case "TRACKING_LOST":
        // Rearm only after a sustained, valid, forward-looking period.
        if (low) {
          if (!this.dwelling) { this.dwelling = true; this.since = t; }
          if (t - this.since >= p.releaseDwellMs) { this.dwelling = false; go("FORWARD_ARMED", "armed"); }
        } else this.dwelling = false;
        break;

      case "FORWARD_ARMED":
        if (high) {
          this.since = t;
          go("RESPONSE_CANDIDATE", "candidate_on");
          if (p.activationDwellMs <= 0) go("RESPONSE_ACTIVE", "response_on");
        }
        break;

      case "RESPONSE_CANDIDATE":
        if (!high) go("FORWARD_ARMED", "candidate_cancel");
        else if (t - this.since >= p.activationDwellMs) go("RESPONSE_ACTIVE", "response_on");
        break;

      case "RESPONSE_ACTIVE":
        if (low) {
          this.since = t;
          go("RELEASE_CANDIDATE", "candidate_off");
          if (p.releaseDwellMs <= 0) go("FORWARD_ARMED", "response_off");
        }
        break;

      case "RELEASE_CANDIDATE":
        if (!low) go("RESPONSE_ACTIVE", "release_cancel");
        else if (t - this.since >= p.releaseDwellMs) go("FORWARD_ARMED", "response_off");
        break;
    }
    return out;
  }
}
