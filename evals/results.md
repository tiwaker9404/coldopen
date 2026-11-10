# coldopen evals

180/180 checks passed across 16 evals, 3 sites and 2 presets, using the deterministic writer. Ran in 23s.

| Eval | Passed | What it checks |
|---|---:|---|
| `brand.primary-color` | 6/6 | Extracted signature color matches the site (OKLab distance under 0.03) |
| `brand.display-font` | 6/6 | Headline typeface identified, so the film uses their font |
| `brand.name` | 6/6 | Company name read correctly |
| `brand.logo` | 6/6 | Logo captured from the header |
| `copy.taste-rules` | 6/6 | Word limits, no banned phrases, no invented numbers, names the company |
| `copy.no-fallback` | 6/6 | The model wrote every line itself; no built-in line was swapped in |
| `copy.quote-on-their-site` | 6/6 | The fact shown on screen appears verbatim on their homepage |
| `copy.uses-a-stat` | 6/6 | The featured fact is a number, which reads strongest on screen |
| `messages.first-try` | 48/48 | Each message draft (note, after accept, InMail, email) passed every check on the first try |
| `messages.no-fallback` | 48/48 | Each message draft kept the writer's own words; no template swapped in |
| `design.text-contrast` | 6/6 | Every text color meets WCAG AA (4.5:1) on its background |
| `design.brand-fonts-loaded` | 6/6 | The site's own font files were embedded, not a fallback |
| `design.no-text-overflow` | 6/6 | No line overflows or breaks its line budget, in square, wide and tall |
| `design.headline-framed` | 6/6 | Their headline sits fully in frame, with a 4% margin, when the homepage zoom settles, in square, wide and tall |
| `motion.frame-exact-seek` | 6/6 | Any frame can be re-rendered pixel-identical (crash-safe rendering) |
| `copy.varied` | 6/6 | No two companies get the same greeting or the same pivot line |

## Messages by draft

| Draft | Passed on the first try | Fell back to the template |
|---|---:|---:|
| note | 12/12 (100%) | 0/12 (0%) |
| afterAccept | 12/12 (100%) | 0/12 (0%) |
| inmail | 12/12 (100%) | 0/12 (0%) |
| email | 12/12 (100%) | 0/12 (0%) |

