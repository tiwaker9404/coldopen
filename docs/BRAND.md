# coldopen's identity

A cold open is the scene before the titles: the minute that decides whether you keep watching.
coldopen makes that minute for every company you apply to. So the brand borrows from the one
place where a short piece of film is made with care for one audience: the set.

Every film coldopen makes wears the other company's brand. coldopen's own brand is the
production around it: the slate, the timecode, the shot list and the credits. It should feel
like a well-run set, not a software dashboard.

## The one idea

**The slate.** On a set, a slate is held up before every take and names the production, the
scene and the take. In coldopen, every film has one: the company, the role, the take (each
edit is a new take) and the running time. It's structure that carries real information, so it
appears wherever a film does: on the landing page's player, on each film in the app, and on
the share page. The black-and-white clapper stripes are the brand's signature, used once per
screen, never as decoration everywhere.

## Color

| Name   | Hex       | Use                                                             |
| ------ | --------- | --------------------------------------------------------------- |
| Stock  | `#FFC21A` | Film-box yellow. The brand field: the hero, the primary button  |
| Slate  | `#000000` | Ink on Stock, clapper stripes, headlines                        |
| Screen | `#F6F6F3` | The page under everything else                                  |
| Grain  | `#5E6168` | Secondary text                                                  |
| Rule   | `#D9DAD6` | Dividers and field edges                                        |
| Tally  | `#E5291F` | The record light. Only for live states: rendering, watched, new |

Dark mode (the app) is the screening room: `#17181B` background, `#212226` surfaces, Stock
stays the accent, ink becomes `#F2F2EE`.

Stock is never used for text on Screen (it fails contrast); text on Stock is always Slate.

Errors aren't live states, so they never use Tally: an error note is Slate text on a 3px Rule
edge with a small "!" mark, so it never rests on color alone. A button that can't be undone
("Delete everything", "Discard") is solid ink; its wording and a confirm step carry the danger.

## Type

- **Big Shoulders Display** for display type: headlines, the slate's fields, timecodes. A
  condensed grotesk drawn from industrial signage, close to the hand-lettered slate and the
  marquee. Set tight, very large, never letterspaced out.
- **Instrument Sans** for everything people read: body, controls, labels.
- No monospace. Timecodes are Big Shoulders with tabular figures.
- Sentence case everywhere. Slate fields are short words ("Company", "Take"), not capitals.

## Layout

- Left-aligned, on a 12-column grid with generous outer margins.
- The hero is a full-bleed Stock field. The headline sits on it in Slate, huge; the player sits
  beside it with the clapper on top and the slate under it.
- Films appear as a filmstrip: frames in a row on a black strip with perforations along both
  edges. The perforations are real structure (each frame is one film).
- A real sequence (how it works) is a shot list, numbered because it is one.
- The page ends on credits: who directed (you), who wrote (your résumé), what it ran on.

## Motion

One orchestrated moment per page: on the landing page the clapper closes once as the first film
starts. Everything else moves only when someone acts. `prefers-reduced-motion` turns the clap
off.

## Voice

Plain, specific and warm. The film vocabulary is a light seasoning in headings ("Take 2",
"Now showing"), never in instructions: a button says what it does ("Make the film"), not a pun.
