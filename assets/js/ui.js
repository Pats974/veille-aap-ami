import {
  PIPELINE_STATUSES,
  csvEscape,
  daysUntil,
  downloadText,
  formatDate,
  recommendation,
  textIncludes,
  uniqueValues
} from "./utils.js";

export function createUI(store) {
  const filters = {
    search: "",
    type: "",
    category: "",
    axis: "",
    territory: "",
    min: "",
    max: "",
    urgent: false,
    sort: "asc"
  };

  const refs = {
    dashboard: document.getElementById("view-dashboard"),
    tbody: document.getElementById("opportunities-tbody"),
    kanban: document.getElementById("view-kanban"),
    sources: document.getElementById("view-sources"),
    checklist: document.getElementById("view-checklist"),
    drawer: document.getElementById("detail-drawer"),
    drawerContent: document.getElementById("drawer-content"),
    warning: document.getElementById("load-error")
  };

  function initBindings() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    document.getElementById("drawer-close").addEventListener("click", closeDrawer);

    bindFilter("search", "input", (v) => (filters.search = v));
    bindFilter("filter-type", "change", (v) => (filters.type = v));
    bindFilter("filter-category", "change", (v) => (filters.category = v));
    bindFilter("filter-axis", "change", (v) => (filters.axis = v));
    bindFilter("filter-territory", "change", (v) => (filters.territory = v));
    bindFilter("filter-deadline-min", "change", (v) => (filters.min = v));
    bindFilter("filter-deadline-max", "change", (v) => (filters.max = v));

    document.getElementById("filter-urgent").addEventListener("change", (e) => {
      filters.urgent = e.target.checked;
      render();
    });
    document.getElementById("sort-deadline").addEventListener("change", (e) => {
      filters.sort = e.target.value;
      render();
    });

    document.getElementById("export-json").addEventListener("click", () => {
      downloadText("aap-watch-export.json", JSON.stringify(store.exportSnapshot(), null, 2), "application/json;charset=utf-8");
    });

    document.getElementById("export-csv").addEventListener("click", () => {
      const rows = filteredOpportunities().map((op) => {
        const local = store.getLocal(op.id);
        return [op.title, op.type, op.category, op.axis, op.territory, op.deadline, local.status, local.owner].map(csvEscape).join(";");
      });
      const header = "Titre;Type;Catégorie;Axe;Territoire;Deadline;Statut;Responsable";
      downloadText("aap-watch-opportunities.csv", [header, ...rows].join("\n"), "text/csv;charset=utf-8");
    });

    document.getElementById("import-json").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const payload = JSON.parse(await file.text());
      store.importSnapshot(payload);
      render();
      e.target.value = "";
    });
  }

  function bindFilter(id, eventType, apply) {
    document.getElementById(id).addEventListener(eventType, (e) => {
      apply(e.target.value);
      render();
    });
  }

  function switchView(view) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
    document.querySelectorAll(".view").forEach((section) => section.classList.remove("is-active"));
    document.getElementById(`view-${view}`).classList.add("is-active");
  }

  function filteredOpportunities() {
    const { opportunities } = store.state;
    return opportunities
      .filter((op) => {
        const local = store.getLocal(op.id);
        const text = [op.title, op.type, op.category, op.axis, op.territory, local.notes].join(" ");
        const due = op.deadline || "9999-12-31";
        const inRange = (!filters.min || due >= filters.min) && (!filters.max || due <= filters.max);
        const urgent = !filters.urgent || ((daysUntil(op.deadline) ?? 999) < 7);
        return (
          textIncludes(text, filters.search) &&
          (!filters.type || op.type === filters.type) &&
          (!filters.category || op.category === filters.category) &&
          (!filters.axis || op.axis === filters.axis) &&
          (!filters.territory || op.territory === filters.territory) &&
          inRange &&
          urgent
        );
      })
      .sort((a, b) => {
        const av = a.deadline || "9999-12-31";
        const bv = b.deadline || "9999-12-31";
        return filters.sort === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }

  function fillSelect(id, values) {
    const select = document.getElementById(id);
    const current = select.value;
    select.querySelectorAll("option:not(:first-child)").forEach((o) => o.remove());
    values.forEach((v) => {
      const option = document.createElement("option");
      option.value = v;
      option.textContent = v;
      select.append(option);
    });
    select.value = current;
  }

  function renderHeaderInfo() {
    const stamp = store.state.meta?.generated_at || "—";
    document.getElementById("last-update").textContent = `Dernière MAJ : ${stamp}`;
    if (store.state.loadError) {
      refs.warning.textContent = `${store.state.loadError} (mode file:// nécessite souvent un import manuel)`;
      refs.warning.classList.remove("hidden");
    } else {
      refs.warning.classList.add("hidden");
    }
  }

  function renderDashboard() {
    if (store.state.loadError) {
      refs.dashboard.innerHTML = '<article class="card"><h3>Erreur de chargement</h3><p>Importez un fichier JSON valide pour afficher les indicateurs.</p></article>';
      return;
    }

    const items = filteredOpportunities();
    const urgent = items.filter((op) => (daysUntil(op.deadline) ?? 999) < 7).length;
    const go = items.filter((op) => store.getLocal(op.id).status === "Go").length;
    refs.dashboard.innerHTML = `
      <div class="cards">
        <article class="card"><h3>Total</h3><p>${items.length}</p></article>
        <article class="card"><h3>Urgentes (&lt;7j)</h3><p>${urgent}</p></article>
        <article class="card"><h3>Go</h3><p>${go}</p></article>
      </div>
    `;
  }

  function renderTable() {
    const items = filteredOpportunities();
    refs.tbody.innerHTML = items
      .map((op) => {
        const local = store.getLocal(op.id);
        return `
          <tr>
            <td>${op.title}</td>
            <td>${op.type || "—"}</td>
            <td>${op.category || "—"}</td>
            <td>${op.axis || "—"}</td>
            <td>${op.territory || "—"}</td>
            <td>${formatDate(op.deadline)}</td>
            <td>${local.status}</td>
            <td><button data-open="${op.id}">Détail</button></td>
          </tr>
        `;
      })
      .join("");

    refs.tbody.querySelectorAll("button[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openDrawer(btn.dataset.open));
    });

    fillSelect("filter-type", uniqueValues(store.state.opportunities, (o) => o.type));
    fillSelect("filter-category", uniqueValues(store.state.opportunities, (o) => o.category));
    fillSelect("filter-axis", uniqueValues(store.state.opportunities, (o) => o.axis));
    fillSelect("filter-territory", uniqueValues(store.state.opportunities, (o) => o.territory));
  }

  function renderKanban() {
    const columns = PIPELINE_STATUSES.map((status) => {
      const cards = store.state.opportunities
        .filter((op) => store.getLocal(op.id).status === status)
        .map((op) => {
          const local = store.getLocal(op.id);
          return `<article class="k-card">
              <strong>${op.title}</strong>
              <small>${formatDate(op.deadline)}</small>
              <small>${local.owner || "Aucun responsable"}</small>
              <div class="k-actions">
                <button data-move="-1" data-id="${op.id}">←</button>
                <button data-open="${op.id}">Ouvrir</button>
                <button data-move="1" data-id="${op.id}">→</button>
              </div>
            </article>`;
        })
        .join("");
      return `<section class="k-col"><h3>${status}</h3>${cards || '<p class="muted">Aucune</p>'}</section>`;
    }).join("");

    refs.kanban.innerHTML = `<div class="kanban-grid">${columns}</div>`;
    refs.kanban.querySelectorAll("button[data-open]").forEach((btn) => btn.addEventListener("click", () => openDrawer(btn.dataset.open)));
    refs.kanban.querySelectorAll("button[data-move]").forEach((btn) => {
      btn.addEventListener("click", () => {
        store.moveStatus(btn.dataset.id, Number(btn.dataset.move));
        render();
      });
    });
  }

  function renderSources() {
    const sources = store.state.meta?.sources || [];
    refs.sources.innerHTML = sources.length
      ? `<ul>${sources.map((s) => `<li><strong>${s.name}</strong> — ${s.last_checked_at || "inconnu"}<br>${s.attribution_text || ""}</li>`).join("")}</ul>`
      : "<p>Aucune source dans _meta.sources.</p>";
  }

  function renderChecklist() {
    refs.checklist.innerHTML = `
      <ul class="checklist">
        <li>✅ Vérifier éligibilité</li>
        <li>✅ Valider budget et ressources</li>
        <li>✅ Identifier partenaires</li>
        <li>✅ Confirmer prochaines actions dans la fiche</li>
      </ul>
    `;
  }

  function openDrawer(id) {
    const op = store.state.opportunities.find((o) => o.id === id);
    if (!op) return;
    const local = store.getLocal(id);
    const score = local.score;
    const total = Object.entries(score)
      .filter(([k]) => k !== "blockers")
      .reduce((sum, [, v]) => sum + Number(v || 0), 0);

    refs.drawerContent.innerHTML = `
      <h2>${op.title}</h2>
      <p><a href="${op.sourceUrl || "#"}" target="_blank" rel="noopener noreferrer">Lien source</a></p>
      <label>Statut
        <select id="d-status">${PIPELINE_STATUSES.map((s) => `<option ${s === local.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      </label>
      <label>Responsable<input id="d-owner" value="${local.owner || ""}" /></label>
      <label>Prochaine action<input id="d-action" value="${local.nextAction || ""}" /></label>
      <label>Date prochaine action<input id="d-next-date" type="date" value="${local.nextDate || ""}" /></label>
      <label>Notes<textarea id="d-notes">${local.notes || ""}</textarea></label>
      <h3>Scoring Go/No-Go</h3>
      <div class="score-grid">
        ${["strategic_fit", "eligibility", "effort", "impact", "timing"].map((k) => `<label>${k}<input data-score="${k}" type="number" min="0" max="5" value="${score[k] || 0}" /></label>`).join("")}
        <label>Blockers<textarea id="d-blockers">${score.blockers || ""}</textarea></label>
      </div>
      <p><strong>Total:</strong> ${total}/25 — <strong>Reco:</strong> ${recommendation(total, score.blockers)}</p>
    `;

    refs.drawer.classList.add("is-open");
    refs.drawer.setAttribute("aria-hidden", "false");

    refs.drawerContent.querySelector("#d-status").addEventListener("change", (e) => store.patchLocal(id, { status: e.target.value }));
    refs.drawerContent.querySelector("#d-owner").addEventListener("input", (e) => store.patchLocal(id, { owner: e.target.value }));
    refs.drawerContent.querySelector("#d-action").addEventListener("input", (e) => store.patchLocal(id, { nextAction: e.target.value }));
    refs.drawerContent.querySelector("#d-next-date").addEventListener("change", (e) => store.patchLocal(id, { nextDate: e.target.value }));
    refs.drawerContent.querySelector("#d-notes").addEventListener("input", (e) => store.patchLocal(id, { notes: e.target.value }));
    refs.drawerContent.querySelectorAll("input[data-score]").forEach((input) => {
      input.addEventListener("change", (e) => store.patchScore(id, { [e.target.dataset.score]: Number(e.target.value) }));
    });
    refs.drawerContent.querySelector("#d-blockers").addEventListener("input", (e) => store.patchScore(id, { blockers: e.target.value }));
  }

  function closeDrawer() {
    refs.drawer.classList.remove("is-open");
    refs.drawer.setAttribute("aria-hidden", "true");
    render();
  }

  function render() {
    renderHeaderInfo();
    renderDashboard();
    renderTable();
    renderKanban();
    renderSources();
    renderChecklist();
  }

  return { initBindings, render };
}
