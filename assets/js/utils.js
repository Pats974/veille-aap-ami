export const PIPELINE_STATUSES = [
  "À qualifier",
  "En analyse",
  "Go",
  "No-Go",
  "Déposé",
  "Abandonné"
];

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

export function pick(record, keys, fallback = "") {
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") return record[key];
  }
  return fallback;
}

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d;
}

export function toISODate(value) {
  const d = parseDate(value);
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function formatDate(value) {
  const d = parseDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(d);
}

export function daysUntil(value) {
  const d = parseDate(value);
  if (!d) return null;
  const now = new Date();
  const ms = d.getTime() - new Date(now.toDateString()).getTime();
  return Math.ceil(ms / 86400000);
}

export function textIncludes(haystack, needle) {
  return (haystack || "").toString().toLowerCase().includes((needle || "").toLowerCase());
}

export function uniqueValues(items, accessor) {
  return [...new Set(items.map(accessor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
}

export function downloadText(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function csvEscape(value) {
  const str = (value ?? "").toString();
  if (/[",\n;]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

export function recommendation(score, blockers) {
  if (blockers?.trim()) return "No-Go (blockers)";
  if (score >= 20) return "Go";
  if (score >= 12) return "À approfondir";
  return "No-Go";
}
