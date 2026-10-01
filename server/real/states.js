// states.js — canonical State/UT names as printed in DPIIT/PIB annexures, plus
// the two-letter codes YC uses in its company location strings.

export const STATES = [
  { key: 'AN', label: 'Andaman and Nicobar Islands' },
  { key: 'AP', label: 'Andhra Pradesh' },
  { key: 'AR', label: 'Arunachal Pradesh' },
  { key: 'AS', label: 'Assam' },
  { key: 'BR', label: 'Bihar' },
  { key: 'CH', label: 'Chandigarh' },
  { key: 'CT', label: 'Chhattisgarh' },
  { key: 'DN', label: 'Dadra and Nagar Haveli and Daman and Diu' },
  { key: 'DL', label: 'Delhi' },
  { key: 'GA', label: 'Goa' },
  { key: 'GJ', label: 'Gujarat' },
  { key: 'HR', label: 'Haryana' },
  { key: 'HP', label: 'Himachal Pradesh' },
  { key: 'JK', label: 'Jammu and Kashmir', aliases: ['Jammu & Kashmir'] },
  { key: 'JH', label: 'Jharkhand' },
  { key: 'KA', label: 'Karnataka' },
  { key: 'KL', label: 'Kerala' },
  { key: 'LA', label: 'Ladakh' },
  { key: 'LD', label: 'Lakshadweep' },
  { key: 'MP', label: 'Madhya Pradesh' },
  { key: 'MH', label: 'Maharashtra' },
  { key: 'MN', label: 'Manipur' },
  { key: 'ML', label: 'Meghalaya' },
  { key: 'MZ', label: 'Mizoram' },
  { key: 'NL', label: 'Nagaland' },
  { key: 'OR', label: 'Odisha' },
  { key: 'PY', label: 'Puducherry' },
  { key: 'PB', label: 'Punjab' },
  { key: 'RJ', label: 'Rajasthan' },
  { key: 'SK', label: 'Sikkim' },
  { key: 'TN', label: 'Tamil Nadu' },
  { key: 'TG', label: 'Telangana' },
  { key: 'TR', label: 'Tripura' },
  { key: 'UP', label: 'Uttar Pradesh' },
  { key: 'UK', label: 'Uttarakhand' },
  { key: 'WB', label: 'West Bengal' },
];

const NAME_TO_KEY = new Map();
for (const s of STATES) {
  NAME_TO_KEY.set(normalise(s.label), s.key);
  for (const a of s.aliases || []) NAME_TO_KEY.set(normalise(a), s.key);
}

function normalise(name) {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
}

export function stateKeyFromName(name) {
  return NAME_TO_KEY.get(normalise(name)) || null;
}

export function stateLabel(key) {
  return STATES.find((s) => s.key === key)?.label || key;
}

// YC location strings look like "Bengaluru, KA, India". YC mostly uses the
// standard two-letter codes, with a few spelled-out or alternate forms.
const YC_REGION_ALIASES = { TS: 'TG', TELANGANA: 'TG', OD: 'OR' };

export function stateKeyFromYcLocation(location) {
  const parts = location.split(',').map((p) => p.trim());
  if (parts[parts.length - 1] !== 'India' || parts.length < 2) return null;
  const region = parts[parts.length - 2];
  const code = YC_REGION_ALIASES[region.toUpperCase()] || region.toUpperCase();
  if (STATES.some((s) => s.key === code)) return code;
  return stateKeyFromName(region);
}
