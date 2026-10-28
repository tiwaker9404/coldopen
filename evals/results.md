# coldopen evals

72/72 checks passed across 12 evals, 3 sites and 2 presets, using the deterministic writer. Ran in 9s.

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
| `design.text-contrast` | 6/6 | Every text color meets WCAG AA (4.5:1) on its background |
| `design.brand-fonts-loaded` | 6/6 | The site's own font files were embedded, not a fallback |
| `design.no-text-overflow` | 6/6 | No line overflows or breaks its line budget, in square, wide and tall |
| `motion.frame-exact-seek` | 6/6 | Any frame can be re-rendered pixel-identical (crash-safe rendering) |

