# The Quantified Athlete

*A field guide to the homelab dashboard — every metric, every composite, every signal,
explained the way you'd want a sharp coach to explain it: what it is, why it's there,
when to trust it, and when to ignore it.*

---

## Prologue — Why this dashboard exists

Two questions run this dashboard:

1. **Is my body ready to train?**
2. **Is my training actually making me stronger?**

Everything else is evidence for one or the other. The dashboard has two halves — the
**body half** (Garmin Health, wearable-driven, 33 metrics per day, passive) and the
**bar half** (Strength Tracker, manually logged, set-level, active). They look separate
on screen, but they aren't separate systems. Body weight flows into strength math.
Yesterday's session flows into today's readiness. HRV-trend decides whether a stalled
lift is a physiological problem or just a bad week.

This document is the reader's manual. By the end you should be able to look at any
number, card, or chart on the dashboard and know (a) what it measures, (b) what formula
produced it, and (c) what decision it exists to inform.

Two ground rules to frame what follows:

- **Every number is answering a question.** If a metric is on the page, it's because
  it helps you answer one of nine total questions (4 body, 5 bar). If you can't match a
  chart to a question, it doesn't belong.
- **Every metric degrades gracefully.** Any field in any row can be null. Any derived
  score redistributes weight across what's available. A day without HRV still has a
  recovery score. A week without strength sessions still has an ACWR.

---

# Part I — The Body Half

## 1. The pipeline

A Python sidecar called `garmin-sync` wakes every six hours, authenticates to Garmin
Connect, pulls the last seven days, and upserts into a single `daily_metrics` table in
SQLite. The seven-day rolling backfill isn't paranoia — Garmin watches sync *after* they
finish charging, after the user opens the mobile app, and sometimes twelve hours late.
Re-fetching the week catches everything. Completed days (those already flagged as
finalised more than six hours in the past) are skipped, which cuts the Garmin API load
by an order of magnitude.

The Elysia API exposes this table as a plain CRUD endpoint. The dashboard fetches a
date range once and computes every derivative client-side. That design choice is worth
a sentence: by keeping analytics in the browser, formula iteration doesn't need a server
deploy. Changing the strain-debt penalty is a commit and a `make dash-deploy` — no API
rebuild, no data migration.

## 2. The raw fields (what each thing actually is)

Thirty-three nullable numeric columns arrive from Garmin each day. They group into
seven families.

### Activity — how much you moved

| Field | What it is | Why it matters |
|-|-|-|
| `steps` | Total steps the watch registered, 00:00–23:59 local | Daily volume floor — walking minutes, commuting, fidgeting |
| `distance_m` | Meters travelled (derived from steps + stride length) | Sanity check on steps — spikes without it mean indoor lifting |
| `total_kcal` | BMR + activity | Gross energy burn; not directly useful for training |
| `active_kcal` | Calories above BMR | Closer to "what the day cost you" |
| `floors_ascended` | Floors climbed | Proxy for vertical work — hikes, stairs, hill running |
| `moderate_intensity_min` | Minutes at 40–59% HRR (Garmin's threshold) | Half of the WHO activity calculation |
| `vigorous_intensity_min` | Minutes at ≥60% HRR | The other half. Worth double in WHO math |

### Heart rate — how your cardiovascular system runs at rest

`resting_hr`, `max_hr`, `min_hr`. RHR is the single best cheap proxy for cardiovascular
fitness. Lower is better, within limits. A chronic drop of 3–5 bpm over a month is a
real fitness gain. A sudden rise of 5+ bpm for 2–3 days is almost always illness,
under-recovery, or acute stress — before you feel it.

### HRV — the autonomic thermometer

Garmin reports four HRV fields from overnight RMSSD measurements:

- `hrv_last_night_avg` — the number that actually gets read
- `hrv_last_night_5min_high` — peak variability during the deepest recovery phase
- `hrv_weekly_avg` — a smoother, less noisy baseline
- `hrv_status` — Garmin's verdict: `BALANCED`, `LOW`, or `UNBALANCED`

HRV is the highest-signal single number Garmin gives you. It goes up when you're
recovered and down when you're stressed, sick, sleep-deprived, drunk, or over-trained.
It's also noisy — a single bad night can drop 20%. Which is why every analysis uses the
7-day moving average, not the raw value.

### Sleep — stages and score

Garmin decomposes the night into `deep_sleep_sec`, `light_sleep_sec`, `rem_sleep_sec`,
and `awake_sleep_sec`. It also computes a `sleep_score` (0–100), `avg_sleep_stress`,
`avg_sleep_hr`, and `avg_sleep_respiration`.

Targets worth memorising: deep sleep in the 13–23% range, REM in the 20–25% range.
Persistent low deep sleep is usually alcohol or stress. Persistent low REM is usually
late-night eating, screens, or medication. `avg_sleep_stress` should live near zero on
a good night — anything above 25 means your autonomic system didn't fully down-shift
even while unconscious.

### Stress and Body Battery — the autonomic ledger

`avg_stress` / `max_stress` are Garmin's minute-by-minute stress estimates on a 0–100
scale, averaged across the day. Body Battery (`bb_highest`, `bb_lowest`, `bb_charged`,
`bb_drained`) is Garmin's energy-balance model — it spends during stress and activity,
charges during rest and sleep. The key insight: `bb_charged > bb_drained` means you
recovered more than you spent today; the opposite means you ran a deficit.

Neither metric is independent evidence — both are derivatives of HRV, RHR, and
movement. But Garmin's formulas are good, and the Body Battery reading on waking
(`bb_highest`, because it peaks just after the sleep cycle) is a surprisingly strong
single-number recovery proxy.

### Respiration, SpO2, VO2 Max — supporting cast

`avg_waking_respiration` matters mostly as an illness early-warning: a +2 breaths/min
sustained uptick usually predates a cold by 24–48 hours. `avg_spo2` / `lowest_spo2`
require the watch's Pulse Ox setting enabled during sleep; under 94% averaged is worth
a check-up. `vo2_max` is Garmin's cardiorespiratory fitness estimate — updated sporadically
(roughly weekly) on days with sufficient cardio activity. Units are ml/kg/min; 45+ is
good for an adult male, 50+ is athletic.

## 3. Daily Activity Score — the canonical effort metric

"How hard did I work today?" is the simplest question in the dashboard and the easiest
to get wrong. The naïve answer is to sum moderate and vigorous minutes with a weight:
`mod × 1 + vig × 1.8` is the classic TRIMP-lite. It ignores your 12k-step day.
Weighting steps is another trap — walking the dog is effort, but not the same MET-minute
as five minutes of vigorous work.

The answer used here follows the **Compendium of Physical Activities** (Ainsworth et
al. 2011), the citable standard for activity intensity:

```
intensity_steps  = (moderate_min + vigorous_min) × 100
walking_steps    = max(0, steps − intensity_steps)
walking_score    = walking_steps × 0.03    (≈ 3 MET, 1 min per 100 steps)
moderate_score   = moderate_min × 4        (4 MET, mid of 3–6 range)
vigorous_score   = vigorous_min × 8        (8 MET, mid of 6–10+ range)

score (MET-min) = walking_score + moderate_score + vigorous_score
```

Three design choices baked in:

1. **De-double-counting.** Each intensity minute is assumed to consume ~100 steps.
   Those steps are removed from the walking term before its MET contribution is added.
   Without this, a 45-minute vigorous run would be counted twice.
2. **WHO's 1 vigorous = 2 moderate.** The 8/4 ratio preserves it naturally, with no
   hand-tuned weighting.
3. **No cap.** The score is bounded only by your actual activity. A 90-minute vigorous
   day legitimately scores 720+ MET-min. That's the point.

The target is **600 MET-min/day** — about 3.5× the WHO weekly floor (500–1000 MET-min
*per week* for general health). That target is tuned for a sportive young adult, not a
population norm. A 45-minute vigorous block plus 10k steps lands you around 540 — close
to target without any moderate work.

Why this beats Whoop Strain for this dashboard: Whoop's 0–21 Strain requires per-minute
heart rate, which Garmin doesn't sync as a daily aggregate. MET-min is reproducible
from the three fields we have, well-validated in exercise science, and interpretable —
you can read a score of 720 and know you did a vigorous session, not a walk.

## 4. Training Load — ACWR and divergence

Daily Activity Score answers "today". Two smoothed versions of it answer "are you
training too much or too little?"

```
λ_acute   = 2 / (7 + 1)  = 0.250      ~7-day half-life
λ_chronic = 2 / (28 + 1) ≈ 0.069      ~28-day half-life

ewma(t) = load(t) × λ + ewma(t−1) × (1 − λ)
```

EWMA (exponentially weighted moving average) beats a rolling mean for training load —
it weighs recent days more, it doesn't have sharp boundary effects, and it tracks
changes without lag-of-N/2 that a simple rolling window gives you. Hulin et al. (2017,
*BJSM*) established this specifically for ACWR.

Then:

```
ACWR = ewma_acute / ewma_chronic
```

| ACWR | Zone | Interpretation |
|-|-|-|
| < 0.8 | Undertrained | insufficient stimulus, detraining risk |
| 0.8–1.3 | Optimal | adaptation sweet spot |
| 1.3–1.5 | Caution | elevated injury risk |
| > 1.5 | Danger | high injury probability |

Thresholds from Gabbett (2016, *BJSM*). Because ACWR is a ratio, it's scale-invariant —
swapping TRIMP for MET-min changes the input but preserves the zone meaning.

A companion chart — **Short vs Long Load** — plots `ewma_acute − ewma_chronic` as a
MACD-style histogram. Green bars mean acute exceeds chronic (building load). Red bars
mean the opposite (deload or detraining). Sign changes are inflection points; stretches
of same-sign bars tell you which training phase you're in. The strength half of the
dashboard reuses this exact pattern for per-lift tonnage divergence.

## 5. Recovery Score — the three-second answer

One number, 0–100, computed every day, answers "am I ready to push?"

```
recovery_raw =
  hrv_component    × 0.40 +
  sleep_component  × 0.35 +
  rhr_component    × 0.25

  hrv_component   = min(100, (hrv_today / hrv_period_avg) × 100)
  sleep_component = sleep_score                                    (0–100)
  rhr_component   = (1 − (rhr − rhr_min) / (rhr_max − rhr_min)) × 100

  Null components → redistribute weight proportionally.
```

Body Battery is *not* in the formula, even though it's in the schema. That's deliberate:
BB is itself a composite of HRV + stress + movement, so including it would double-count
the same underlying physiology. Keeping the formula to HRV + sleep + RHR means each
input is observably different and the weights are legible.

### Strain-debt adjustment

Raw recovery doesn't know that yesterday you did a hard session. This is a problem: if
HRV, sleep, and RHR all point to "green" but you destroyed yourself 12 hours ago, the
score will tell you to push. The adjustment:

```
ceiling     = max(500, p90(activity_scores))     personal ceiling, floored at 500
strain_debt = clamp(0, 1, yesterday_score / ceiling)
recovery    = recovery_raw × (1 − strain_debt × 0.30)
```

The ceiling is **dynamic and personal**: the 90th percentile of your own MET-min history
becomes the anchor. If your p90 day is ~800 MET-min, yesterday's 700 shaves recovery
by ~26%. The 500 MET-min floor handles new users with sparse history. The maximum
penalty is 30% — enough to meaningfully push the verdict down, not enough to invert it.

Rest days (yesterday's score is zero) trigger no penalty. Missing yesterday (new user,
watch dead) also no penalty. And alcohol? Not modelled. It doesn't need to be — it
already shows up as reduced HRV, worse sleep score, and elevated RHR the next morning.
The existing components catch it.

Zones:

| Range | Verdict |
|-|-|
| ≥ 70 | **Push** — train hard, attempt intensity |
| 40–69 | **Normal** — standard session |
| < 40 | **Rest** — prioritise recovery |

## 6. Fitness Direction — three-level slope verdict

"Am I getting fitter?" Linear regression slope over the last 14 days for RHR and HRV.
This used to be a 5-level signal (Accelerating / Improving / Maintaining / Declining /
Regressing). It got collapsed to 3 levels because the finer gradations weren't
actionable — a user reads "Improving ▲" and either trusts it or not; the degree is a
drill-down concern, not a hero concern.

```
rhr_positive  = rhr_slope < −0.05 bpm/day
hrv_positive  = hrv_slope > +0.10 ms/day
rhr_negative  = rhr_slope > +0.05 bpm/day
hrv_negative  = hrv_slope < −0.10 ms/day

Improving (▲)  at least one positive and no negative
Declining (▼)  at least one negative and no positive
Stable (►)     conflicting signals, or neither moves enough
```

VO2 Max overrides: if VO2 is rising (≥ 2 measurements in the window, latest > previous)
and RHR/HRV are flat, the verdict stays "Improving". VO2 Max moves slowly but is the
purest cardio-fitness signal we have.

## 7. Fitness Trends — personal z-scores

Three cardiovascular markers — RHR 7d MA, HRV 7d MA, VO2 Max — all tell you something
about fitness. They live on incompatible scales (bpm vs ms vs ml/kg/min). Plotting them
on the same axis always distorts one to favour another.

The fix: convert each to a **personal z-score** against its own rolling baseline.

```
μ_field = mean(field_ma)                           personal baseline
σ_field = sampleStdDev(field_ma)                   personal variance
z(x)    = (x − μ_field) / max(σ_field, floor)      SD-floor prevents blow-up
```

RHR is flipped: `z_rhr = −(rhr_ma − μ) / σ`. Now on every series, up is better. The
chart shows σ units (−2σ to +2σ) and every point reads as "how far from your own
baseline, in standard deviations." The tooltip keeps the raw numbers (47 bpm, 82 ms,
53.3 VO2) so you don't lose the physiological meaning.

SD floors: 0.5 (RHR), 1.0 (HRV), 0.2 (VO2). They prevent a nearly-constant series
from producing absurd z-scores — if your RHR has only moved ±0.1 bpm in 90 days, we
don't let a 0.3 bpm blip read as +3σ.

This pattern is worth internalising because the strength half reuses it for the
**Strength Composite** chart (§ 14).

## 8. Sleep Quality — diverging stack

The sleep chart is a diverging bar chart with a clear grammar: **stages above the
baseline, `awake_sleep_sec` below it, sleep score as a line on the right axis, target
band 7–9 hours**. "Above the line" is recovery, "below" is fragmentation. The
semantic is legible without reading the legend.

The header-extra shows last night's sleep score plus total hours. Score categories
follow Garmin's bands:

```
≥ 90  Excellent
80–89 Good
60–79 Fair
< 60  Poor
```

## 9. Energy Balance — the BB ledger

`bb_charged` above the baseline (green), `bb_drained` below it (red). A grey Net line
overlays on the left axis. No right axis, no secondary metrics — the story is whether
today was a recovery day or a deficit day. A run of negative Net bars over the ACWR
caution window is the cleanest "you're digging a hole" signal the dashboard produces.

Formerly this was called "Body Battery" but that name confused the chart (BB level) with
the hero sub-metric (morning BB peak). The rename to "Energy Balance" fixed it — the
chart shows the *balance*, not the level.

## 10. Stress Levels — color is the metric

Daily average stress plotted against overnight sleep stress. A vertical SVG
`<linearGradient>` under the `avg_stress` line is mapped to the stress zones —
green 0–25, yellow 25–50, orange 50–75, red 75–100. The color *is* the stress level.
You can read the chart with your eyes closed.

`max_stress` is deliberately omitted. On any active day, it pegs near 80–90 — no signal,
just constant ceiling. `avg_sleep_stress` is the more interesting one to keep: should
hug zero, excursions upward mean disrupted sleep-phase autonomic control.

## 11. The four questions the body half answers

| # | Question | Composite signal | Min data |
|-|-|-|-|
| 1 | Am I recovered enough today? | Recovery Score (0–100) | 7 days |
| 2 | Am I getting fitter over time? | Fitness Direction (3-level) | 14 days |
| 3 | Am I training the right amount? | Daily Activity + ACWR | 14 days |
| 4 | How well am I sleeping? | Sleep Score + stage stack | immediate |

Two secondary questions live beneath:

- **Am I overtraining?** — ACWR > 1.3 AND Recovery < 50 AND (RHR 7d MA rising OR HRV
  7d MA declining). Confidence rises if sleep score < 60 for 3+ days, avg_stress > 50
  for 3+ days, or BB never reaching 75 for 3+ days.
- **Am I detraining?** — ACWR < 0.8 AND chronic_load declining AND RHR trending up.

---

# Part II — The Bar Half

Where Garmin Health is a passive firehose, Strength Tracker is deliberate. You log every
set. The payoff is that every metric is attributable to an exact session, an exact
weight, an exact rep count. Nothing is estimated from a wrist-bound accelerometer.

## 12. The pipeline

Three tables do the heavy lifting:

- `exercises` — the reference table. Four seed rows today (bench_press, squat, deadlift,
  pull_ups), each with `category`, `muscle_group`, and an `is_bodyweight` flag.
- `workouts` — one row per session-exercise pair. Date, exercise FK, optional RIR
  (Reps in Reserve, 0–5, for the top working set), optional notes.
- `workout_sets` — one row per set. Set number, type (`warmup` / `work` / `drop` /
  `amrap`), weight, reps.

Three supporting wearable tables get reused:

- `weight_log` — manual bodyweight entries
- `daily_metrics` — source of truth for recovery-based readiness
- `user_profile` — height, gender, birthdate (for DOTS normalisation)

Dynamic bodyweight is important. A pull-up is "zero kg added" but the total load is your
bodyweight plus any added plate. The dashboard walks `weight_log → daily_metrics →
profile default`, in that order, to find the bodyweight for any given date. A 100 kg
bench at 80 kg BW is more impressive than 110 kg at 100 kg BW — without the date-aware
bodyweight lookup, the dashboard can't tell the difference.

## 13. e1RM — the canonical strength measure

One-rep-max from a real max-effort single is rare. e1RM (estimated 1RM) from a
submaximal set is what you actually get. Two formulas, averaged:

```
Brzycki: e1RM = W × 36 / (37 − R)        valid R ∈ [1, 10]
Epley:   e1RM = W × (1 + R / 30)          valid R ∈ [1, 12]

Average when both valid. Brzycki only when R > 10 (up to 12). Reject R > 12.
```

Mayhew was in the original version and got dropped. Mayhew is tuned for bench press and
systematically under-estimates squat and deadlift in untrained-to-intermediate lifters.
Brzycki+Epley has the widest published validation across all three powerlifts.

### Validity gate — not every set counts

```
eligible = set_type ∈ {work, amrap}
           AND reps ∈ [1, 12]
           AND (RIR is null OR RIR ≤ 3)
```

Why the gate:

- **Set type**: warmups and drop sets are not max-effort attempts. A 60%-of-1RM warmup
  would give a wildly inflated e1RM if we naively plugged it in.
- **Reps**: both formulas' error explodes beyond 12 reps. A 20-rep set tells you about
  muscular endurance, not 1RM.
- **RIR**: a set with RIR 4+ was "sandbagged" — you left too many reps in the tank, and
  the e1RM is an underestimate. Gating at ≤ 3 keeps the e1RM honest.

### Per-workout e1RM

`best_e1RM(workout) = max(e1RM)` over eligible sets. Ties broken by higher absolute
weight. The set that produced it is stored alongside — the 1RM chart tooltip reads
"best set: 120×6 @ RIR 2 → e1RM 143.9 kg" so you can see the evidence, not just the
derived number.

### Bodyweight exercises

`effective_weight = weight_kg + body_weight(date)` for `is_bodyweight = 1`. Pull-ups with
no added weight are valid — they just have `weight_kg = 0`. A 10-rep bodyweight pull-up
at 80 kg BW is a 106 kg e1RM, a meaningful number that a vanilla log would throw away.

## 14. INOL — the single best quality score

Intensity × volume in one dimensionless number. Hristov's framework:

```
INOL_set  = reps / (100 − %e1RM)         where %e1RM = (ew / best_e1RM) × 100,
                                               clamped to [40, 99]
INOL_session = Σ INOL_set    over eligible sets only
```

The clamp does two things: rejects noise from very light back-off sets (below 40%) and
prevents a singularity at 100% (a true-max set would divide by zero).

Zones (Hristov):

| INOL | Zone | Interpretation |
|-|-|-|
| < 0.4 | Too light | insufficient stimulus |
| 0.4 – 0.6 | Recovery | deload / technique work |
| **0.6 – 1.0** | **Optimal** | **effective loading** |
| 1.0 – 1.5 | Hard | sustainable short-term (peaking blocks) |
| > 1.5 | Excessive | high fatigue risk |

INOL answers "was that session quality or junk?" Five sets of 10 at 60% is a 2.0 INOL
(junk volume). Three heavy triples at 85% is a 1.0 INOL (optimal). It's the closest
strength training has to a single-session verdict.

The dashboard renders INOL as a **dot per session** — not a line. Sessions are discrete
events, not a continuous signal. Connecting them implies a continuity that doesn't
exist: training every Monday and Thursday doesn't have values on Tuesday. A dashed
line showing the 10-session moving average runs through the dots.

## 15. Tonnage and the Strength ACWR

```
total_volume(session)   = Σ (effective_weight × reps)  over ALL sets
work_volume(session)    = Σ (effective_weight × reps)  over eligible sets only
tonnage_week(exercise)  = Σ total_volume  per ISO week
```

Tonnage (weekly kg lifted, per exercise) is the input to the Strength ACWR. Same EWMA
formula as Garmin Health, but the input is a weekly series (ISO weeks, missing weeks
fill with 0):

```
N_acute   = 4   (~4-week horizon)
N_chronic = 16  (~4-month horizon)

λ = 2 / (N + 1)
ewma(t) = load(t) × λ + ewma(t−1) × (1 − λ)

ACWR(ex) = ewma_acute / ewma_chronic
```

Zones are identical to the body half — the Gabbett thresholds (0.8 / 1.3 / 1.5) were
developed on training-injury data, and they generalise across load proxies.

The per-lift divergence histogram — `ewma_acute − ewma_chronic` — is the MACD pattern
again. Building load (positive) during accumulation, shed load (negative) during
deload, sign change on phase inflection. The strength half uses it per-exercise; the
body half uses it globally. Same chart, different input.

**Global training load** across lifts uses **INOL-weighted tonnage** so a junk-volume
lift doesn't dominate an INOL-rich one:

```
load_week = Σ (tonnage_week(ex) × clamp(INOL_avg(ex), 0.4, 1.5))
```

## 16. Velocity and Momentum — where you're heading

Applied to the per-lift `best_e1RM` time series. First and second derivatives, the
strength-coach version of Kurvendiskussion:

```
f'(t)  = d(e1RM) / dt
       = slope of linear regression of e1RM over [t − 28d, t], kg/day
       divided by e1RM → %/day (comparable across lifts)

f''(t) = d(f'(t)) / dt
       = slope of f'(t) over [t − 28d, t]
```

**Strength Direction** — per-lift 3-level verdict:

```
velocity > +0.10 %/day (≈ +3%/month)  → Improving (▲)
−0.05 ≤ velocity ≤ +0.10 %/day        → Stable (►)
velocity < −0.05 %/day                → Declining (▼)
```

Sub-text from `f''(t)`: "accelerating" when both positive, "decelerating" when f' is
positive and f'' is negative. This is the drill-down that tells you not just *where*
your lift is going but *how the trend itself is trending*. Stale at the current level
(f' > 0, f'' < 0) is the early warning that a deload or program change is coming.

## 17. Personal volume landmarks — MEV, MAV, MRV

Classical models (Israetel, RP Strength) hardcode "10 sets per muscle group per week
minimum effective volume." That's a population average, not your number. The dashboard
computes all three landmarks from **your own** weekly tonnage history (per exercise,
90-day window, zero-tonnage weeks excluded):

```
MEV(ex) = p25(tonnage_week(ex))    minimum effective volume
MAV(ex) = p50(tonnage_week(ex))    maximum adaptive volume
MRV(ex) = p90(tonnage_week(ex))    maximum recoverable volume
```

Three horizontal dashed lines across the Weekly Volume chart. Sitting in MEV–MAV for a
mesocycle = accumulation phase. Spiking to MRV = peaking. Falling below MEV for > 2
weeks with no e1RM gain = detraining risk and the Deload Signal (§ 20) starts watching.

Same design pattern as the strain-debt ceiling in the body half: a personal p-value is
the anchor, not a hardcoded threshold. What counts as "a lot" depends on what you've
been doing.

## 18. DOTS — comparing yourself across bodyweights

Raw `1RM_deadlift / 1RM_squat` is noisy when your body weight changes. A weight cut
improves the ratio without any strength gain; a bulk does the opposite. **DOTS** (IPF
2020) is the current standard replacement for Wilks — normalises to a common bodyweight
via a fifth-order polynomial fit against the IPF database.

```
DOTS(e1RM, bw, sex) = e1RM × 500 / (A + B·bw + C·bw² + D·bw³ + E·bw⁴)
```

Two sex-specific coefficient sets (male and female). Both are in `analytics.ts` verbatim
from the IPF PDF, verified against OpenPowerlifting.

Ratios of DOTS-adjusted e1RMs are what the **Strength Ratios** chart plots. Normative
ranges are from the 2024 PubMed meta-analysis over 809,986 IPF entries:

| Ratio | Expected range | Note |
|-|-|-|
| Deadlift / Squat | 1.0 – 1.25 | Squat-dominant → lower, DL specialist → higher |
| Squat / Bench | 1.2 – 1.5 | Below 1.2 signals leg weakness |
| Deadlift / Bench | 1.5 – 2.0 | Above 2.0 is unusual anterior-chain deficit |
| Pull-up / BW | 0.4 – 0.7 | Weighted pull-up ratio: added weight / BW |

Status bands:

```
Balanced    ratio within expected range
Imbalanced  ratio outside by > 15%
Critical    ratio outside by > 30%
```

The chart itself is a horizontal bar chart with the normative range as a green band and
the current ratio as a colored tick. Status appears in the card's header-extra as
"worst pair + status" — "DL/Bench critical · 2.3" at a glance.

## 19. Strength Composite — the z-score chart

Same pattern as Fitness Trends, swapped inputs. Three per-lift quality signals:

- **Velocity** — %/day from § 16
- **Tonnage growth** — `tonnage_this_week / MA28(tonnage)`, ratio
- **INOL** — session average over the window

All three on incompatible scales. Same fix: personal z-scores.

```
μ = mean over 90-day window
σ = sample stdev over 90-day window

z = (value − μ) / max(σ, floor)

floors: velocity 0.05 %/day · tonnage_growth 0.02 (ratio) · INOL 0.1
```

One chart per active lift, on a shared σ axis (−2σ to +2σ), 7-day MA per series, raw
values in the tooltip. Dashed zero line is your personal baseline. Each point reads as
"how far from my own baseline, in standard deviations." When the three series align
upward, the gain is broad-based (all three dimensions are improving together) — the
cleanest signal of a productive training block. When they diverge, you see the story:
tonnage up but velocity flat = accumulation phase (expected), velocity up but INOL
down = taper/peak phase (also expected).

## 20. PR density and the Deload Signal

A PR (personal record) is an e1RM above all previous e1RMs for that exercise. PR
**density** over time is the cleanest mesocycle-effectiveness signal:

```
PR(ex, t) = e1RM(ex, t) > max(e1RM(ex, τ)) for all τ < t

pr_density_4w(ex)    = count(PR events) over last 28 days
pr_density_4w(total) = Σ over all active lifts
```

Expected pattern: 0–2 PRs per accumulation week, spike in a peaking week, zero during a
deload. Flat zero for 4+ weeks across all lifts means the program has stalled.

**Deload Signal** — multi-signal detector that fires when at least two of four
conditions trigger simultaneously (single-signal triggers are false-positive machines):

```
signals = {
  stall:    f'(e1RM) ≤ 0 for 3+ consecutive weeks on ≥ 2 key lifts
  overload: ACWR > 1.3 for 2+ consecutive weeks on ≥ 1 key lift
  fatigue:  avg INOL > 1.1 over last 10 sessions
  physio:   (wearable) Garmin Fitness Direction = Declining
            OR HRV 7d MA down > 15% vs 28d baseline
}

verdict:
  ≥ 2 active  → Deload recommended
  = 1 active  → Monitor — one stressor active
  = 0 active  → Progress mode
```

Research consensus (PMC 2024 Delphi): deload every 4–8 weeks, ~1 week long, reduce
volume 40–50% while holding 60–70% intensity. The dashboard additionally flags a
proactive deload after 8 weeks of "Progress mode" regardless of signal state — insurance
against "but I feel fine" drift.

## 21. The five questions the bar half answers

| # | Question | Composite signal | Wearable? |
|-|-|-|-|
| 1 | Am I getting stronger on the lifts I care about? | Strength Direction (per-lift ▲/►/▼) | No |
| 2 | Am I loading smart or just hard? | Load Quality (INOL + ACWR + MEV–MAV–MRV) | No |
| 3 | Are my lifts balanced? | Balance (DOTS-adjusted ratios) | No |
| 4 | Should I push, sustain, or deload today? | Readiness × Strain | Partial |
| 5 | When should I deload? | Deload Signal (multi-signal) | Partial |

### Load Quality composite (Question 2)

```
load_quality = 40% × INOL zone score
             + 40% × ACWR zone score
             + 20% × volume landmark score
```

Each component scores 100 inside its optimal zone and falls off linearly by distance
from the zone. The **dragComponent** field names which of the three is dragging the
score — the drill-down lives in the hero card's sub-text, not hidden in a tooltip.

Verdict bands:

```
≥ 75  Quality   — training is effective and sustainable
50–74 Adequate  — one component drifting, check the drill-down
< 50  Poor      — junk volume OR overload risk (ACWR disambiguates)
```

---

# Part III — The Intersection

The two halves are not independent systems. This section documents every place they
feed each other.

## 22. Body weight flows everywhere

The most important cross-half dependency. The strength math gets bodyweight from a
three-level walk:

```
body_weight(date) = weight_log[date] 
                 ?? weight_log[nearest previous]
                 ?? daily_metrics.weight_kg[date]    (when Garmin scale synced)
                 ?? user_profile.default_weight
```

Uses:

- **Bodyweight exercises**: `effective_weight = weight + bw(date)` — a 0-kg pull-up
  becomes a real load.
- **Relative strength**: `best_e1RM / bw(date)` — the number that survives weight change.
- **DOTS**: normalises for bodyweight change. Cutting 5 kg without losing the lift is a
  real strength gain; DOTS quantifies it.
- **Strength ratios**: all plotted on DOTS-adjusted e1RMs, so the ratios don't drift
  with your weight.

## 23. Readiness × Strain — fatigue debt for the bar

The Recovery Score (§ 5) knows about yesterday's aggregate activity. It doesn't know
that a heavy strength session hits the CNS harder than a run of equivalent MET-min.
The Readiness × Strain chart adds a strength-specific **fatigue-debt** adjustment on
top of the Garmin recovery number:

```
fatigue_ceiling = max(1.0, p90(session_INOL))     personal per-session ceiling
yesterday_inol  = INOL of most recent session within 48h, else null
fatigue_debt    = clamp(0, 1, yesterday_inol / fatigue_ceiling)

readiness = garmin_recovery × (1 − fatigue_debt × 0.25)
if yesterday_inol > 1.2:
  readiness *= 0.9                                extra 10% for heavy sessions
readiness = clamp(0, 100, readiness)
```

Same design DNA as the Garmin strain-debt: personal ceiling from your own p90, capped
maximum penalty (25% from fatigue debt, plus 10% for genuinely heavy sessions for a
worst-case 33%), no penalty on rest days. The 48-hour lookback reflects the reality
that strength fatigue persists 48–72 hours for heavy sessions but clears in 24 for
moderate ones.

Without wearable data (new user, watch dead, Garmin outage), the signal falls back to
a pure training-state detector:

```
PUSH verdict = 
  Strength Direction = Improving
  AND Load Quality ≥ 75
  AND (yesterday was rest OR yesterday_inol < 0.6)
```

## 24. The Alignment Matrix — 3×3 today

Five zones from the body half (Recovery: High ≥ 70 / Normal 40–69 / Low < 40) × three
from the bar half (ACWR: Under < 0.8 / Optimal 0.8–1.3 / Caution+ > 1.3). A 3×3 grid
of verdicts:

|  | ACWR Under | ACWR Optimal | ACWR Caution+ |
|-|-|-|-|
| **Recovery High** | Waste | **Aligned · Push** | Misaligned · Risk |
| **Recovery Normal** | Light | **Aligned** | Overload · Risk |
| **Recovery Low** | **Aligned · Rest** | Misaligned | **Critical · Risk** |

Each cell shows the count of past sessions that landed in it (so you learn which cells
you frequent), today's cell gets a colored border, and a cell hover lists the last 8
dates in that cell. This teaches the user a pattern they won't see in any single
chart: "I tend to do heavy sessions on low-recovery days" is a diagnosable habit.

## 25. Deload Signal — physio confirmation

The fourth signal in the Deload detector (§ 20) is a cross-half confirmation:

```
physio = 
  Garmin Fitness Direction = Declining
  OR HRV 7d MA down > 15% vs 28d baseline
```

This is what makes a stall on two lifts go from "probably a deload" to "definitely a
deload." Without the physio signal, Progress mode can mask a real over-reach that the
strength-only metrics are too slow to detect.

---

# Part IV — The Design DNA

Principles carried across both halves. If anything in the dashboard feels coherent,
it's because these are applied consistently.

## 26. Personal z-scores for dissimilar scales

Any time you need to plot two or more metrics that live on different scales on the same
axis, normalise to personal z-scores. Applied here:

- **Fitness Trends** — RHR, HRV, VO2 Max on σ axis
- **Strength Composite** — velocity, tonnage growth, INOL on σ axis

The principle generalises: when the population mean is uninformative (everyone has
different RHR baselines), your *own* mean is. Floor the SD so a near-constant series
doesn't produce runaway z-scores.

## 27. EWMA over rolling means

Rolling means have sharp boundaries and lag every signal by ~N/2. EWMA weighs recent
values more, has no boundary artefacts, and tracks changes without lag. Used for
training load on both halves (acute 7d, chronic 28d body; acute 4wk, chronic 16wk bar).

## 28. Personal ceilings via p90

When a threshold is "what counts as a lot *for you*", use the 90th percentile of your
own history. Used for:

- **Strain-debt ceiling** in Recovery Score (p90 of your own Activity Scores)
- **Fatigue-debt ceiling** in Readiness × Strain (p90 of your own session INOLs)
- **MEV / MAV / MRV** in Weekly Volume (p25 / p50 / p90 of your own weekly tonnage)

Always with a floor so new users with sparse history don't get degenerate thresholds.

## 29. MACD-style divergence

`ewma_acute − ewma_chronic` as a histogram reveals regime changes faster than the ratio
alone. Sign changes are inflection points; runs of same-sign bars reveal phase. Used on
both halves — global training load divergence (body), per-lift tonnage divergence (bar).

## 30. Client-side analytics

The API returns raw rows and a few per-workout aggregates that need sets to compute
(max weight, best-set e1RM, total volume). Everything else is derived in the dashboard.
Changing any formula in this document is a dashboard deploy, not an API deploy. This
is why the document can name formulas — they are actually the formulas in the code.

## 31. Four-tier reading model

Every view on the dashboard fits one of four tiers:

| Tier | Content | Purpose |
|-|-|-|
| 1 — Answers | 3 hero cards per half | 3-second read |
| 2 — Evidence | 8–10 charts per half | Data behind the answers |
| 3 — Drill-down | Tooltip per chart + header-extra | Per-date detail |
| 4 — Raw | Sparkline grid + History view | Dense scan, session-level edit |

You read top-down: answer → evidence → detail → raw. The bar half's sparkline grid is
a compact per-lift summary that substitutes for the full dashboard when you want a
scan in under a second.

## 32. Naming discipline

One concept, one name. Hero card label = section title = chart card title. "Recovery"
at the hero level, "Recovery & Sleep" at the section, "Recovery Trend" at the chart —
same concept, consistent nominal hierarchy. Rename fixups shipped during development:
*Training* → *Training Load* (hero), *Body Battery* → *Energy Balance* (chart), *Sleep
Breakdown* → *Sleep Quality* (chart — the score is the primary number, stages are
evidence).

Every chart has a **6-word subtitle** — the question it answers, authored as
`<ChartCard subtitle="…">`. Every chart has a **header-extra** in the card's top-right
slot showing today's reading. If a chart can't produce a header-extra, it's missing a
feature.

## 33. Cross-chart hover sync

A single `HoverContext` provider wraps each page. Hovering any chart broadcasts the
date; every other chart draws a ghost crosshair at the same x. The same session reads
the same on every chart simultaneously. Implemented via `useHoverSync<T>` — never
reimplement the closest-point loop inline. The user isn't choosing between charts;
they're reading one coherent view of a day.

## 34. Visx primitives only

Recharts is out. Every chart wraps in `ChartCard` (title + subtitle + header-extra +
info-tooltip), legends are `ChartLegend`, tooltips are `ChartTooltip` + `TooltipHeader` +
`TooltipRow` + `TooltipBody`, axes are `AxisLeftNumeric` / `AxisBottomDate`. Theme-aware
colors via `useVxTheme()`; semantic palette (good/bad/warn/grid) and per-metric series
colors (VX.series.hrv, VX.series.deadlift, …) live in a single `tokens.ts`. No raw hex
literals in chart files. No `@visx/tooltip` imports (banned by oxlint). No
`localStorage.getItem('theme')`.

The point isn't ceremony. It's that when a new chart uses a different tooltip style or a
different tick formatter, the dashboard loses coherence fast. The primitive contract
keeps it legible.

---

## Epilogue — what this dashboard is (and isn't)

It is:

- **A decision tool.** Every number is there to inform one of nine questions. The three
  most-used: *Am I recovered?* *Am I overloading?* *Is this lift progressing?*
- **An honest mirror.** Personal z-scores, personal p90 ceilings, personal MEV/MAV/MRV.
  Your numbers, not population averages.
- **A research record.** The formulas are cited (Brzycki, Epley, Ainsworth, Hulin,
  Gabbett, Hristov, IPF DOTS 2020). The derivations are in the code. You can audit
  any score by following the function chain — no black boxes.
- **A graceful degrader.** Any field nullable on any day. Any component missing
  redistributes its weight. The Recovery Score on a day without HRV is still a number
  you can trust, just a less precise one.

It is not:

- **A population dashboard.** The Activity Score target is 600 MET-min/day for a
  sportive young adult. The strength ratios are normed against IPF powerlifters.
  These are *personal* targets with *external* references, not universal thresholds.
- **A complete physio model.** We don't have per-minute heart rate, so we can't
  compute real TRIMP or Whoop Strain. We don't have continuous glucose. We don't have
  mood or nutrition logs. MET-min is a good-enough approximation for the effort
  question and that's all it's trying to be.
- **A finished product.** The first three sections (hero cards, evidence charts,
  drill-downs) are shipped. The sparkline grid shipped. The alignment matrix shipped.
  The cross-half fatigue-debt adjustment shipped. Future work lives in
  `docs/STRENGTH-ANALYTICS.md` Part 7 and `docs/GARMIN-HEALTH.md` Part 6.

The thesis the whole thing is organised around: *if you can answer nine questions well,
with every answer attributable to evidence you can audit and every evidence chart
trackable back to a raw measurement, you have a training dashboard that's worth the
time to log every set.*

---

## References

The formulas above are not original. Primary sources:

| Source | Contribution |
|-|-|
| Ainsworth et al. (2011) — *Compendium of Physical Activities* | MET multipliers (8 vig, 4 mod, 3 walk) |
| Banister (1991) — TRIMP | Original training-impulse formula |
| Brzycki (1993) — NSCA Journal | 1RM estimation (valid R ∈ [1, 10]) |
| Epley (1985) — NSCA | 1RM estimation (valid R ∈ [1, 12]) |
| Gabbett (2016) — *BJSM* | ACWR zones (0.8 / 1.3 / 1.5) |
| Helms et al. (2023) — MASS Review | RIR methodology |
| Hristov | INOL framework and zone bands |
| Hulin et al. (2017) — *BJSM* | EWMA superiority for ACWR |
| IPF (2020) | DOTS coefficients (replaces Wilks) |
| Israetel — RP Strength (2023) | Volume landmarks (MEV/MAV/MRV) |
| Nature Sci Reports (2025) | HRV-guided training readiness |
| PMC Delphi study (2024) | Deload timing consensus (4–8 week cadence) |
| PubMed (2024) — 809,986 entries | Normative powerlifting strength ratios |
| Schoenfeld et al. (2024) — JSCR | Volume-hypertrophy dose-response |
| WHO (2020) | Physical Activity Guidelines, MET-min/week targets |

For the reference-manual view of each half, see `docs/GARMIN-HEALTH.md` and
`docs/STRENGTH-ANALYTICS.md`. For the chart-primitive contract, see
`~/SourceRoot/dotfiles/rules/visx-charts.md` and
`.claude/rules/visx-charts.md`.
