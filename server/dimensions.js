// Shared dimension definitions and ground-truth plant parameters. Only the
// real-world names/structure (cities, communities, program names) come from
// public research; every weight and rate below is synthetic and tuned to
// realize the planted findings described in PRD.md.

export const CITIES = [
  { key: 'mumbai', label: 'Mumbai', weight: 22, plant: 'looks_big_converts_badly' },
  { key: 'bengaluru', label: 'Bengaluru', weight: 18, plant: 'control' },
  { key: 'delhi_ncr', label: 'Delhi NCR', weight: 14, plant: 'baseline' },
  { key: 'pune', label: 'Pune', weight: 10, plant: 'control' },
  { key: 'hyderabad', label: 'Hyderabad', weight: 9, plant: 'baseline' },
  { key: 'chennai', label: 'Chennai', weight: 9, plant: 'funnel_leak' },
  { key: 'ahmedabad', label: 'Ahmedabad', weight: 8, plant: 'control' },
  { key: 'lucknow', label: 'Lucknow', weight: 5, plant: 'baseline' },
  { key: 'jaipur', label: 'Jaipur', weight: 3, plant: 'baseline' },
  { key: 'kochi', label: 'Kochi', weight: 2, plant: 'small_sample' },
];

export const COMMUNITIES = [
  { key: 'tech_plus', label: 'Tech+', weight: 45, plant: 'baseline' },
  { key: 'd2c_plus', label: 'D2C+', weight: 35, plant: 'baseline' },
  { key: 'xport_plus', label: 'Xport+', weight: 20, plant: 'underinvested' },
];

export const CHANNELS = [
  { key: 'organic_incorporation', label: 'Organic incorporation', weight: 40 },
  { key: 'referral', label: 'Referral', weight: 20 },
  { key: 'buildathon', label: 'Buildathon', weight: 12 },
  { key: 'linkedin_content', label: 'LinkedIn content', weight: 18 },
  { key: 'genie_reengagement', label: 'Rize Genie re-engagement', weight: 10 },
];

// Program launch age (days ago). Programs younger than OUTCOME_MATURITY_DAYS
// cannot have a measured outcome yet — nobody selected into them has reached
// the 6-month mark. This is the actual mechanism, not a hardcoded exception.
export const OUTCOME_MATURITY_DAYS = 180;

export const PROGRAMS = [
  { key: 'rize_for_yc', label: 'Rize for YC', launchedDaysAgo: 650, selectRate: 0.12, outcomeRate: 0.55 },
  { key: 'buildathon_program', label: 'Buildathon', launchedDaysAgo: 420, selectRate: 0.06, outcomeRate: 0.5 },
  { key: 'grp', label: 'Global Readiness Program', launchedDaysAgo: 18, selectRate: 0.1, outcomeRate: null },
  { key: 'founder_buddy', label: 'Founder-Buddy Program', launchedDaysAgo: 12, selectRate: 0.11, outcomeRate: null },
];

export function cityByKey(key) {
  return CITIES.find((c) => c.key === key);
}
export function communityByKey(key) {
  return COMMUNITIES.find((c) => c.key === key);
}
export function programByKey(key) {
  return PROGRAMS.find((p) => p.key === key);
}
