/** Text heuristics shared by site research and résumé reading. No browser needed. */

/** Collapse text a page renders twice (screen-reader copies, animated counters, marquee clones). */
export function tidy(text: string): string {
  let w = text.replace(/\s+/g, ' ').trim().split(' ')
  if (w.length >= 2 && w.length % 2 === 0) {
    const half = w.length / 2
    if (w.slice(0, half).join(' ') === w.slice(half).join(' ')) w = w.slice(0, half)
  }
  // a live counter caught mid-tick renders two near-identical numbers: keep the first
  for (let i = 0; i + 1 < w.length; i++) {
    const a = w[i]!,
      b = w[i + 1]!
    const num = (x: string) => Number.parseFloat(x.replace(/,/g, ''))
    if (
      /^\d[\d.,]{4,}%?$/.test(a) &&
      /^\d[\d.,]{4,}%?$/.test(b) &&
      a.endsWith('%') === b.endsWith('%') &&
      Math.abs(num(a) - num(b)) <= Math.abs(num(a)) * 1e-4
    ) {
      w.splice(i + 1, 1)
      i--
    }
  }
  // an immediately repeated run: "1.73958189% 1.73958189%", "teams and agents teams and agents"
  for (let k = Math.floor(w.length / 2); k >= 1; k--) {
    for (let i = 0; i + 2 * k <= w.length; i++) {
      const a = w.slice(i, i + k).join(' ')
      if (a === w.slice(i + k, i + 2 * k).join(' ') && (k >= 3 || /\d/.test(a))) {
        w.splice(i + k, k)
        i--
      }
    }
  }
  return w.join(' ')
}

/** Something a person would quote back to a company: not UI chrome, code, or a chat prompt. */
export function quotable(t: string): boolean {
  if (/^[a-z]/.test(t)) return false // prompts and fragments from product mockups
  if (/\b[a-z]+_[a-z_]+\b|\b[a-z]+[A-Z][a-zA-Z]+\(|[{}<>=]/.test(t)) return false // code
  if (/:$/.test(t)) return false // a label for something that follows
  if (t === t.toUpperCase() && /[A-Z]{4}/.test(t)) return false // eyebrow labels
  return true
}

/** A number worth putting on screen: a percent, a multiple, money, a count, a scale. */
export function isStat(t: string): boolean {
  const s = t
    .replace(/\bv?\d+(\.\d+){1,3}\b(?!\s*%)/g, ' ') // version numbers
    .replace(/\b24\/7\b|\b(19|20)\d{2}\b/g, ' ') // "24/7", years
  return (
    /\d\s*%|\d\s*[x×]\b|[$€£]\s*\d|\d[\d,.]*\s*(k|m|b|bn|mm|million|billion|thousand)\b|\d{1,3}(,\d{3})+|\d+\+/i.test(
      s,
    ) ||
    /\b\d{2,}\s+[a-z]/i.test(s) ||
    /\b\d+(\.\d+)?\s*(ms|sec|seconds?|min|minutes?|hrs?|hours?|days?|weeks?|months?)\b/i.test(s)
  )
}
