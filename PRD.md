# Rize Compass — PRD

## Context
Built independently after the Razorpay Rize x Replit Buildathon (Sept 19, 2026). This is not a Razorpay product
and carries no real Rize data. It demonstrates a statistically honest decision-support
method, applied to Rize's own public founder lifecycle, as a conversation piece.

## Grounding facts (public, verified by search, not invented)
- Razorpay Rize: startup program launched 2021. Free company incorporation,
  5,000+ registrations to date.
- Three founder communities: Tech+, D2C+, Xport+.
- Flagship programs: Rize for YC (application review tool, 17 startups into YC),
  Global Readiness Program (GRP: invite-only 6-day intensive, just launched, 50
  selected from hundreds of applicants), Founder-Buddy Program (3-month mentorship,
  20 senior Razorpay leaders paired with founders, just launched), buildathons,
  Venture Investment Program (with Peak XV, Lightspeed).
- All specific per-founder, per-city numbers in this build are SYNTHETIC. Only the
  program names, structure, and "just launched" status of GRP/Founder-Buddy are real.

## Problem
Rize runs real acquisition and engagement motions (incorporation, content, buildathons,
community programs) across multiple cities and channels, but has no honest way to tell
which ones actually convert founders into program success versus which ones just look
active. Raw engagement numbers (posts, RSVPs, incorporations) don't separate signal from
noise, and two new flagship programs have no track record yet to judge against.

## Who it's for
A Rize marketing/growth lead deciding where to put budget and content effort next quarter:
which city or channel to double down on, which to deprioritize, and which new program is
too new to have an opinion about yet.

## Non-goals
No real Rize data, no claim of operational use, no login, no live integrations.

## Funnel (synthetic, structurally matches Rize's real lifecycle)
Incorporated -> Joined community (Tech+ / D2C+ / Xport+) -> Active (posts, event
attendance, Rize Genie usage) -> Applied to a flagship program -> Selected ->
Outcome (YC admit / funded / still active at 6 months)

Dimensions: city (10 Indian cities), community (Tech+, D2C+, Xport+), channel
(organic incorporation, referral, buildathon, LinkedIn content, Genie re-engagement),
program (Rize for YC, GRP, Founder-Buddy, Buildathon).

## Planted findings (ground truth, hidden from the UI except on the Validation page)
1. City "looks big, converts badly": high incorporation volume, community
   activation rate far below median.
2. Segment "underinvested": small base, disproportionate program-application and
   YC-admit rate.
3. Signal miscalibration: event RSVP is weighted heavily as an engagement score,
   but Genie usage frequency predicts program application better.
4. Funnel leak: strong "Active" numbers, weak "Applied to program" conversion,
   pointing at a visibility/targeting gap rather than a demand gap.
5. Insufficient data (true to reality): GRP and Founder-Buddy launched this month.
   The tool refuses a verdict on either, same mechanism as the "Kochi" refusal in
   the earlier build.
6. Controls: two to three healthy cities/communities that should trigger no
   decision card at all.

## Statistics (plain code, unit tested, same discipline as the earlier build)
Wilson confidence intervals on every rate. Empirical-Bayes shrinkage for rankings.
Minimum-sample rule returning "insufficient data." Two-proportion significance
tests with multiple-comparison correction. Cost/effort-per-outcome with interval.
Signal-lift analysis (RSVP vs Genie usage as predictors of program application).
The LLM, if used at all, never computes a number; only plain code does.

## Screens
1. Funnel: Incorporated -> Community -> Active -> Applied -> Selected -> Outcome,
   with interval-backed drop-off at each stage, sliceable by city/community/channel.
2. Program Performance: per-program (YC, GRP, Founder-Buddy, Buildathon) metrics
   with intervals; GRP and Founder-Buddy explicitly marked "too new to call."
3. City & Community Lab: Raw vs Adjusted ranking toggle (empirical-Bayes shrinkage),
   Before/After panel contrasting raw-rate conclusions with adjusted conclusions.
4. Decisions: cards with recommendation, impact range, evidence, confidence,
   and "what could make this wrong," framed as budget/program-investment calls.
5. Validation: a script checks whether the planted findings are recovered, controls
   stay quiet, and a shuffled-label run produces no confident findings. Page reads
   real results from a file, never hardcoded.
6. About: honest framing — built independently after the buildathon conversation,
   all data illustrative, method is domain-agnostic, this is what it could look
   like pointed at Rize's own analytics.

## Acceptance criteria
- Every rate on screen carries an interval or "insufficient data."
- GRP and Founder-Buddy never get a confident verdict anywhere in the app.
- Controls produce no decision card.
- The "looks big, converts badly" and "underinvested" findings both surface with
  evidence and a corrected significance test.
- Validation page numbers come from an actual run, including any misses.
