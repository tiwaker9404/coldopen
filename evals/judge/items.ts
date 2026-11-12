/**
 * The items as the recipient receives them: the slots the app fills in ([First name], [film])
 * shown the way they arrive, and a film's on-screen lines, scene by scene. Pure.
 */

import { FILM } from '../../src/outreach/writer.ts'
import type { Storyboard } from '../../src/script/storyboard.ts'

/** What the recipient sees in place of the slots the app fills in */
export const asReceived = (text: string, where: 'email' | 'linkedin') =>
  text
    .replaceAll('[First name]', 'Sam')
    .replaceAll(
      FILM,
      where === 'email'
        ? '[a GIF of the 30-second film, linked to it]'
        : '[the 30-second film, attached as a GIF]',
    )

/** Every line on screen, scene by scene, as the recipient reads them */
export function filmLines(board: Storyboard): string {
  const out: string[] = []
  for (const s of board.scenes) {
    if (s.kind === 'hook') out.push(`Scene 1, opening: ${s.text}`, `  under it: ${s.sub}`)
    if (s.kind === 'site') out.push(`Scene 2, over your homepage: ${s.caption}`)
    if (s.kind === 'insight')
      out.push(
        `Scene 3, a line quoted from you: ${s.value ? `${s.value} ` : ''}${s.text}`,
        `  caption: ${s.caption}`,
        `  then: ${s.why}`,
      )
    if (s.kind === 'pitch')
      out.push(`Scene 4, the pitch: ${s.headline}`, ...s.points.map((p) => `  - ${p}`))
    if (s.kind === 'proof')
      out.push(
        `Scene 5, proof cards${s.heading ? ` (${s.heading})` : ''}:`,
        ...s.stats.map(
          (p) =>
            `  - ${p.value} ${p.label}${p.did ? ` / ${p.did}` : ''}${p.where ? ` / ${p.where}` : ''}`,
        ),
      )
    if (s.kind === 'cta')
      out.push(
        `Scene 6, the ask: ${s.line}`,
        `  ${s.signoff}`,
        ...(s.made ? [`  Made with ${s.made.name}, which I built`] : []),
      )
  }
  return out.join('\n')
}
