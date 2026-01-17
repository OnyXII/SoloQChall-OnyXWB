const API_ELO = `${API_BASE}/api/elo`;
const IMAGE_DIR = "Image";
const RANK_DIR = "rang";
const CHAMP_DIR = "Champions";

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPct(n, digits = 0) {
  const v = Number(n || 0);
  return `${v.toFixed(digits).replace(".", ",")}%`;
}

function playerImg(name) { return `${IMAGE_DIR}/${name}.png`; }
function rankImg(tier) { return `${RANK_DIR}/${tier}.png`; }
function champImg(champName) { return `${CHAMP_DIR}/${champName}.png`; }

function avatarHTML(name) {
  const img = playerImg(name);
  return `
    <div class="avatar">
      <img src="${img}" alt="${escapeHtml(name)}"
        onerror="this.style.display='none'; this.parentElement.classList.add('img-missing');" />
    </div>
  `;
}

/**
 * ✅ Champion: wrapper non-coupant + rond + badge (pas coupé)
 */
function champIconHTML(ch) {
  const name = String(ch?.name || "Unknown");
  const games = Number(ch?.games || 0);
  const winRate = Number(ch?.winRate || 0);
  const img = champImg(name);

  const title = `${name} — ${games} game(s) — WR ${formatPct(winRate, 0)}`;

  return `
    <div class="eloChamps__wrap" title="${escapeHtml(title)}">
      <div class="eloChamps__item">
        <img class="eloChamps__img" src="${img}" alt="${escapeHtml(name)}"
          onerror="this.style.display='none'; this.parentElement.classList.add('img-missing');" />
      </div>
      ${games > 0 ? `<span class="eloChamps__badge">${games}</span>` : ""}
    </div>
  `;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderElo(players) {
  const root = document.getElementById("elo");
  if (!root) return;

  root.innerHTML = (players || [])
    .map((p, idx) => {
      const place = idx + 1;
      const crown = place === 1 ? `<span class="crown">👑</span>` : "";

      const tier = p.tier || "UNRANKED";
      const rankText = p.queueRankText || "Unranked";
      const lpText = (p.lp === null || p.lp === undefined) ? "" : `${p.lp} LP`;
      const wrText = `WR ${formatPct(p.winRate, 0)}`;

      const icon =
        tier === "UNRANKED"
          ? ""
          : `<img class="rankIcon" src="${rankImg(tier)}" alt="${escapeHtml(tier)}"
              onerror="this.style.display='none';" />`;

      const topChamps = Array.isArray(p.topChampions)
        ? [...p.topChampions].sort((a, b) => Number(b.games || 0) - Number(a.games || 0)).slice(0, 5)
        : [];

      return `
        <div class="eloRow">
          <div class="eloRow__top">

            <div class="eloRow__left">
              <div class="place ${place === 1 ? "place--first" : ""}">${place}${crown}</div>

              <div class="rankBadge">
                ${icon}
                ${avatarHTML(p.name)}
              </div>

              <div class="eloInfo">
                <div class="playerCard__name">${escapeHtml(p.name)}</div>
                <div class="playerCard__sub">${escapeHtml(rankText)} • ${escapeHtml(lpText)} • ${wrText}</div>
              </div>
            </div>

            <!-- champions -->
            <div class="eloChamps" aria-label="Top champions">
              ${topChamps.map(champIconHTML).join("")}
            </div>

            <div class="playerCard__stats">
              <div class="statPill"><strong>Games</strong> ${p.games ?? 0}</div>
            </div>

          </div>
        </div>
      `;
    })
    .join("");
}

async function init() {
  const meta = document.getElementById("metaElo");
  try {
    const data = await fetchJson(API_ELO);
    renderElo(data.players);

    const cached = data.cached ? ` • cache: ${data.cached}` : "";
    meta.textContent = `maj: ${new Date(data.generatedAt).toLocaleString()}${cached}`;
  } catch (e) {
    console.error(e);
    if (meta) meta.textContent = `Erreur API: ${e.message}`;
  }
}

init();
