import { PIPELINE_STATUSES, asArray, pick, toISODate } from "./utils.js";

const LOCAL_KEY = "aap_watch_local_v1";
const DATA_CANDIDATES = [
  "data/opportunities.seed.json",
  "./data/opportunities.json",
  "./data/data.json"
];

export function createStore() {
  const state = {
    meta: {},
    opportunities: [],
    local: loadLocalState(),
    rawDataPath: null,
    loadError: ""
  };

  async function loadDataset() {
    for (const path of DATA_CANDIDATES) {
      try {
        const response = await fetch(path);
        if (!response.ok) continue;
        const payload = await response.json();
        hydrateFromPayload(payload);
        state.rawDataPath = path;
        state.loadError = "";
        return;
      } catch {
        // continue
      }
    }
    state.loadError = "Impossible de charger automatiquement un fichier JSON depuis ./data. Utilisez Importer JSON.";
  }

  function hydrateFromPayload(payload) {
    if (Array.isArray(payload)) {
      state.meta = {};
      state.opportunities = payload.map((record, index) => normalizeOpportunity(record, index));
      return;
    }

    state.meta = payload?._meta || {};
    const source = Array.isArray(payload?.opportunities)
      ? payload.opportunities
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    state.opportunities = source.map((record, index) => normalizeOpportunity(record, index));
  }

  function normalizeOpportunity(record, index) {
    const id = pick(record, ["id", "slug", "uid", "name", "title"], `op-${index + 1}`);
    const title = pick(record, ["title", "name", "label"], "Sans titre");
    const type = pick(record, ["type", "opportunity_type", "program_type"], "");
    const category = pick(record, ["category", "categories", "theme"], "");
    const axis = pick(record, ["axis", "axe", "axes"], "");
    const territory = pick(record, ["territory", "location", "zone"], "");
    const deadline = pick(record, ["deadline", "application_deadline", "end_date"], "");
    const sourceUrl = pick(record, ["url", "source_url", "link"], "");
    return {
      id: String(id),
      title,
      type: asArray(type).join(", "),
      category: asArray(category).join(", "),
      axis: asArray(axis).join(", "),
      territory: asArray(territory).join(", "),
      deadline: toISODate(deadline),
      sourceUrl,
      raw: record
    };
  }

  function loadLocalState() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function persistLocalState() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state.local));
  }

  function getLocal(id) {
    return state.local[id] || {
      notes: "",
      status: PIPELINE_STATUSES[0],
      owner: "",
      nextAction: "",
      nextDate: "",
      score: {
        strategic_fit: 0,
        eligibility: 0,
        effort: 0,
        impact: 0,
        timing: 0,
        blockers: ""
      }
    };
  }

  function patchLocal(id, patch) {
    state.local[id] = { ...getLocal(id), ...patch };
    persistLocalState();
  }

  function patchScore(id, scorePatch) {
    const current = getLocal(id);
    patchLocal(id, { score: { ...current.score, ...scorePatch } });
  }

  function moveStatus(id, direction) {
    const current = getLocal(id);
    const index = PIPELINE_STATUSES.indexOf(current.status);
    if (index < 0) return;
    const next = PIPELINE_STATUSES[index + direction];
    if (!next) return;
    patchLocal(id, { status: next });
  }

  function exportSnapshot() {
    return {
      _meta: state.meta,
      opportunities: state.opportunities.map((item) => item.raw),
      local: state.local
    };
  }

  function importSnapshot(payload) {
    if (Array.isArray(payload?.opportunities)) {
      hydrateFromPayload(payload);
    }
    if (payload?.local && typeof payload.local === "object") {
      state.local = payload.local;
      persistLocalState();
    }
  }

  return {
    state,
    loadDataset,
    getLocal,
    patchLocal,
    patchScore,
    moveStatus,
    exportSnapshot,
    importSnapshot
  };
}
