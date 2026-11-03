/**
 * A link from outside data (a job board, YC's directory, a company's site) as an href only
 * when it's a web or mail link: never javascript: or data:, whatever the source sends.
 */
export function safeUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined
  return /^(https?:\/\/|mailto:)/i.test(u.trim()) ? u : undefined
}
