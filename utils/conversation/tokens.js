const SAFETY_MARGIN = 1.1;
const LATIN_WEIGHT = 0.3;
const CJK_WEIGHT = 1;
const SYMBOL_WEIGHT = 1.5;

// Hiragana, Katakana, CJK ideographs, Hangul, and fullwidth forms.
const CJK =
  /[\u{3040}-\u{30ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{ac00}-\u{d7af}\u{ff00}-\u{ffef}]/u;

function weightOf(char) {
  if (char.charCodeAt(0) < 0x80) return LATIN_WEIGHT;
  if (CJK.test(char)) return CJK_WEIGHT;
  // Kaomoji symbols, emoji and other non-Latin characters often split into several tokens.
  return SYMBOL_WEIGHT;
}

/** Rough token count: weighted per character, rounded up with a safety margin. */
export function estimateTokens(text) {
  let total = 0;
  for (const char of text) total += weightOf(char);
  return Math.ceil(total * SAFETY_MARGIN);
}
