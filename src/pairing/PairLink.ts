export type LinkState = "idle" | "live" | "stale" | "dead";
export type PairRole = "clinician" | "patient";

export interface LinkStatus {
  connected: boolean;
  state: LinkState;
  role: PairRole | null;
  peerBackground: boolean;
  rttMs?: number;
}

/** Transport between the two devices. RapidPair in production; a loopback for development. */
export interface PairLink {
  readonly status: LinkStatus;
  /** Show the pairing UI for this role. Resolves once the UI is shown. */
  open(role: PairRole): Promise<void>;
  /** True while this link's own pairing dialog is on screen. */
  isDialogOpen(): boolean;
  /** Hide the pairing dialog if it opened by itself (e.g. after a disconnect). */
  closeDialog(): void;
  /** Returns false if the message could not be sent. */
  send(type: string, payload: unknown): boolean;
  on(type: string, cb: (payload: any) => void): () => void;
  onStatus(cb: (s: LinkStatus) => void): () => void;
  disconnect(): void;
}
