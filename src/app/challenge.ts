import { decodeShare, type SharedRun } from "../benchmark/share-codec";

// ---------------------------------------------------------------------------
// A comparison being set up ("Set up the same test"): the shared run's code, held in memory and in
// sessionStorage (this tab only) so it survives a reload or a crash. Nothing starts a run; the
// next run the user starts carries it onto the result. No cookies, nothing sent anywhere.
// ---------------------------------------------------------------------------
export const PENDING_KEY = "ogb.challenge.v1";

let pending: string | null = null;

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The pending comparison's code, from memory or (after a reload) this tab's sessionStorage. */
export function pendingCode(): string | null {
  if (pending) return pending;
  try {
    const c = session()?.getItem(PENDING_KEY) ?? null;
    if (c && decodeShare(c).ok) pending = c;
  } catch {
    /* unavailable: no pending comparison */
  }
  return pending;
}

/** The pending comparison's run, decoded. */
export function pendingRun(): SharedRun | null {
  const c = pendingCode();
  if (!c) return null;
  const d = decodeShare(c);
  return d.ok ? d.payload.runs[d.payload.type === "comparison" ? 1 : 0] : null;
}

export function setPending(code: string): void {
  pending = code;
  try {
    session()?.setItem(PENDING_KEY, code);
  } catch {
    /* in memory only */
  }
}

/** "Stop comparing", or the comparison was shown on its result. */
export function clearPending(): void {
  pending = null;
  try {
    session()?.removeItem(PENDING_KEY);
  } catch {
    /* nothing stored */
  }
}
