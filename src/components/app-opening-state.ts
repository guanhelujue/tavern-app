const OPENING_SESSION_KEY = 'tavern-opening-sequence-seen-v1';

export type OpeningSessionStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const runtimeState = globalThis as typeof globalThis & {
  __tavernOpeningSequenceClaims?: Set<string>;
};

/**
 * Claims the one full-screen opening allowed for this app process / browser
 * session. Storage failures deliberately fall back to the in-process gate.
 */
export function claimAppOpeningSequence(
  storage?: OpeningSessionStorage,
): boolean {
  const claims = runtimeState.__tavernOpeningSequenceClaims ?? new Set<string>();
  runtimeState.__tavernOpeningSequenceClaims = claims;
  if (claims.has(OPENING_SESSION_KEY)) return false;

  try {
    if (storage?.getItem(OPENING_SESSION_KEY)) {
      claims.add(OPENING_SESSION_KEY);
      return false;
    }
  } catch {
    // The in-process gate still prevents route-remount replays.
  }

  claims.add(OPENING_SESSION_KEY);
  try {
    storage?.setItem(OPENING_SESSION_KEY, 'seen');
  } catch {
    // Startup animation must never fail because browser storage is unavailable.
  }
  return true;
}

export function resetAppOpeningSequenceForTests() {
  delete runtimeState.__tavernOpeningSequenceClaims;
}
