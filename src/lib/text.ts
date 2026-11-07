/**
 * Summaries for progressive disclosure: the first sentence of validated AI text, never rewritten.
 * Returns the whole text when it has no sentence break (or the break would leave a fragment).
 */
export function firstSentence(text: string): string {
  const t = text.trim();
  // A sentence ends at . ! ? followed by a space and an uppercase letter/digit (avoids "e.g. ", "approx. 3").
  const m = t.match(/^(.+?[.!?])\s+(?=[A-Z0-9“"(])/);
  if (!m) return t;
  const first = m[1];
  return first.length >= 24 ? first : t; // too short to stand alone (e.g. "Note."): keep the full text
}

/** True when the summary already shows the full text, so a "more" control would add nothing. */
export const isWhole = (text: string) => firstSentence(text) === text.trim();
