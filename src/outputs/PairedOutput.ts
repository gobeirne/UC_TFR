import type { ResponseEvent, ResponseOutput } from "./ResponseOutput";
import { MSG, type RespMsg } from "../pairing/protocol";

/** Sends RESPONSE_ON/OFF to a paired clinician remote. Just another output plug-in. */
export class PairedResponseOutput implements ResponseOutput {
  readonly name = "paired";
  private seq = 0;
  constructor(private send: (type: string, payload: unknown) => boolean) {}
  onResponseStart(e: ResponseEvent) { this.send(MSG.resp, { on: true, seq: ++this.seq, score: e.score } satisfies RespMsg); }
  onResponseEnd(e: ResponseEvent) {
    this.send(MSG.resp, { on: false, seq: ++this.seq, score: e.score, cancelledByTrackingLoss: e.cancelledByTrackingLoss } satisfies RespMsg);
  }
}
