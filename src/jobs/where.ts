import type { Job } from './boards.ts'

/**
 * Where a job is, and how senior it is, from what the boards give: a country field when there is
 * one (Ashby, Lever), otherwise the location text; the level from the title.
 */

const STATES =
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
    ' ',
  )
const STATE_NAMES =
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming'
const US_CITIES =
  'san francisco|sf bay area|bay area|silicon valley|new york|nyc|manhattan|brooklyn|seattle|austin|boston|cambridge|chicago|los angeles|denver|boulder|atlanta|miami|dallas|houston|san diego|san jose|palo alto|mountain view|menlo park|sunnyvale|redwood city|oakland|portland|philadelphia|pittsburgh|washington dc|arlington|raleigh|durham|salt lake city|phoenix|minneapolis|detroit|nashville|columbus|st\\. louis'
const US = new RegExp(
  `\\b(united states|u\\.s\\.a?\\.?|usa|us|${STATE_NAMES}|${US_CITIES})\\b|,\\s*(${STATES.join('|')})\\b`,
  'i',
)
const ELSEWHERE =
  /\b(canada|toronto|vancouver|montreal|mexico|brazil|são paulo|sao paulo|argentina|colombia|uk|united kingdom|england|london|ireland|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|madrid|barcelona|portugal|lisbon|poland|warsaw|switzerland|zurich|sweden|stockholm|denmark|copenhagen|israel|tel aviv|india|bangalore|bengaluru|hyderabad|mumbai|delhi|pune|chennai|singapore|japan|tokyo|korea|seoul|china|shanghai|beijing|hong kong|taiwan|australia|sydney|melbourne|new zealand|philippines|manila|vietnam|indonesia|uae|dubai|emea|apac|latam|europe|asia)\b/i

/** Is the job in the US, or remote with no other country named? */
export function inUS(j: Pick<Job, 'location' | 'country' | 'remote'>): boolean {
  const c = j.country?.trim().toLowerCase()
  if (c) {
    if (/^(us|usa|united states( of america)?)$/.test(c)) return true
    // the board names one country for the main office; another office may still be in the US
  }
  const loc = j.location ?? ''
  // any one of a post's offices in the US counts
  if (loc.split(/\s*[|;•]\s*/).some((part) => US.test(part) && !ELSEWHERE.test(part))) return true
  if (c) return false
  // "Remote" with no country at all: open to people in the US
  return !ELSEWHERE.test(loc) && (j.remote || /remote|anywhere/i.test(loc))
}

export const LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead', 'director'] as const
export type Level = (typeof LEVELS)[number]

/** How senior a role is, read from its title */
export function levelOf(title: string): Level {
  const t = title.toLowerCase()
  if (
    /\b(intern|internship|co-?op|apprentice|new grad|graduate|university|campus|student)\b/.test(t)
  )
    return 'intern'
  if (/\b(director|head of|vp|vice president|chief|executive|president|cto|ceo|cfo|coo)\b/.test(t))
    return 'director'
  if (/\b(staff|principal|lead|architect|distinguished|fellow)\b|\b(iv|v)\b/.test(t)) return 'lead'
  if (/\b(senior|sr\.?|manager)\b|\biii\b/.test(t)) return 'senior'
  if (/\b(entry|junior|jr\.?|associate|early career)\b|\bi\b/.test(t)) return 'entry'
  return 'mid'
}

/** Whether a role manages people, from its title */
export function managesOf(title: string): boolean {
  return (
    /\b(manager|director|head of|vp|vice president|chief|cto|ceo)\b/i.test(title) &&
    !/\b(account manager|product manager|program manager|project manager|technical account manager|success manager)\b/i.test(
      title,
    )
  )
}

/** Requirement lines that limit who can apply */
export const CLEARANCE =
  /\b(security clearance|ts\/sci|top secret|secret clearance|clearance required|active clearance|clearable)\b/i
export const CITIZEN_ONLY =
  /\b(u\.?s\.? citizens? only|must be a u\.?s\.? citizen|u\.?s\.? citizenship (is )?required|requires? u\.?s\.? citizenship)\b/i

/** The fewest years of experience a post's requirements ask for, if any line says */
export function yearsAsked(requirements: string[]): number | null {
  let min: number | null = null
  for (const r of requirements) {
    for (const m of r.matchAll(
      /\b(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?\b/gi,
    )) {
      const n = Number(m[1])
      if (n > 0 && n <= 25 && (min === null || n < min)) min = n
    }
  }
  return min
}
