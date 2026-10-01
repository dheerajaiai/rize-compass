// ui.js — formatting + DOM helpers shared by every screen. Formatting only:
// nothing here computes a statistic.

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return (x * 100).toFixed(digits) + '%';
}
export function num(x) {
  if (x === null || x === undefined) return '—';
  return x.toLocaleString('en-IN');
}
export function intervalText(stage) {
  if (!stage || stage.insufficientData) return null;
  if (stage.low === null || stage.high === null) return null;
  return `95% CI: ${pct(stage.low)} – ${pct(stage.high)}`;
}
export function confidenceClass(label) {
  if (!label) return 'confidence-low';
  if (label === 'high') return 'confidence-high';
  if (label === 'medium') return 'confidence-medium';
  return 'confidence-low';
}
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

