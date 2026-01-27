import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = 5174;

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

app.use(express.static(path.join(dirname, "..")));

app.get("/", (req, res) => {
  res.sendFile(path.join(dirname, "..", "index.html"));
});


/* =========================================================
   ⚠️ CLÉ RIOT EN DUR
========================================================= */
const RIOT_API_KEY = "RGAPI-1a86cab7-1a1d-46f0-8af3-2846f939dffc";

/* =========================================================
   CONFIG FIXE
========================================================= */
const PLATFORM = "euw1";   // league-v4
const REGIONAL = "europe"; // account-v1 + match-v5

// ✅ 420 = SoloQ, 440 = Flex
const QUEUE_ID = 420;

// ✅ sample stats page — léger
const SAMPLE_MATCHES_PER_PLAYER = 20;

// ✅ top champions affichés sur la page elo — augmente ici
const TOP_CHAMPS_MATCHES_PER_PLAYER = 50;

/**
 * ✅ Date FIXE: Jeudi 8 janvier 12h (France)
 * Janvier = UTC+1 => 11:00 UTC
 * Unix seconds:
 */
const MATCH_FROM_UNIX = 1767870000;

// TTL caches mémoire
const TTL_STATS_MS = 10 * 60 * 1000;
const TTL_ELO_MS = 2 * 60 * 1000;

// Joueurs
const PLAYERS = [
  { id: "OnyX",    gameName: "KC OnyX",    tagLine: "2602",  display: "OnyX" },
  { id: "Mect",    gameName: "Mect",       tagLine: "EUW",   display: "Mect" },
  { id: "Jigo",    gameName: "TCS Jigo",   tagLine: "3607",  display: "Jigo" },
  { id: "AD",      gameName: "A D",        tagLine: "CDF",   display: "AD" },
  { id: "Bobou",   gameName: "TCS Bobou",  tagLine: "KCWIN", display: "Bobou" },
  { id: "Ch4k",    gameName: "Perceval",   tagLine: "RPD",   display: "Ch4k" },
  { id: "Larbex",  gameName: "TCS Larbex", tagLine: "AKUMA", display: "Larbex" },
  { id: "Skyyy",   gameName: "Skyyyz",     tagLine: "EZZ",   display: "Skyyy" },
  { id: "Mystère", gameName: "Mams",       tagLine: "69200", display: "Mystère" },
  { id: "Milou",   	gameName: "NSMilou",    	tagLine: "EUW",   display: "Milou" },
  { id: "Arfineto",	gameName: "Arfineto",       tagLine: "EUW",   display: "Arfineto" },

];

app.use(express.json());

// CORS pour le front python :5173
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ------------------- Cache disque -------------------
const CACHE_DIR = path.join(process.cwd(), ".cache");
const MATCH_DIR = path.join(CACHE_DIR, "matches");
const PUUID_FILE = path.join(CACHE_DIR, "puuid.json");

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(MATCH_DIR)) fs.mkdirSync(MATCH_DIR, { recursive: true });

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJsonSafe(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

let puuidCache = readJsonSafe(PUUID_FILE, {});

// ------------------- Utils -------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riotFetch(url, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });

    if (res.ok) return res.json();

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      const waitMs = Math.min(3500, Math.max(1000, retryAfter * 1000));
      console.log(`⏳ 429 rate limit — attente ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const txt = await res.text().catch(() => "");
    throw new Error(`Riot API error ${res.status} on ${url} :: ${txt}`);
  }

  const err = new Error("RATE_LIMIT");
  err.code = "RATE_LIMIT";
  throw err;
}

// ------------------- Riot calls -------------------
async function getPuuid(gameName, tagLine) {
  const key = `${gameName}#${tagLine}`;
  if (puuidCache[key]) return puuidCache[key];

  const url = `https://${REGIONAL}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const data = await riotFetch(url);

  puuidCache[key] = data.puuid;
  writeJsonSafe(PUUID_FILE, puuidCache);
  return data.puuid;
}

// ✅ IDs queue + filtre date startTime
async function getQueueMatchIds(puuid, count) {
  const params = new URLSearchParams();
  params.set("queue", String(QUEUE_ID));
  params.set("start", "0");
  params.set("count", String(count));

  // ✅ filtre date FIXE
  if (MATCH_FROM_UNIX > 0) {
    params.set("startTime", String(MATCH_FROM_UNIX));
  }

  const url =
    `https://${REGIONAL}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?` +
    params.toString();

  return riotFetch(url);
}

async function getMatch(matchId) {
  const file = path.join(MATCH_DIR, `${matchId}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));

  const url = `https://${REGIONAL}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  const match = await riotFetch(url);

  fs.writeFileSync(file, JSON.stringify(match), "utf8");
  return match;
}

async function getLeagueEntriesByPuuid(puuid) {
  const url = `https://${PLATFORM}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
  return riotFetch(url);
}

// ------------------- Compute stats -------------------
function computeBaseStats(matches, puuid) {
  let games = 0;
  let kills = 0, deaths = 0, assists = 0;
  let totalCS = 0;
  let totalMin = 0;
  let totalDmgToChamps = 0;

  for (const m of matches) {
    const info = m?.info;
    if (!info) continue;

    const p = info.participants?.find(x => x.puuid === puuid);
    if (!p) continue;

    const gameMin = (info.gameDuration || 0) / 60;

    games++;
    kills += p.kills || 0;
    deaths += p.deaths || 0;
    assists += p.assists || 0;

    totalCS += (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
    totalMin += gameMin;

    totalDmgToChamps += p.totalDamageDealtToChampions || 0;
  }

  const kda = deaths === 0 ? (kills + assists) : (kills + assists) / deaths;
  const csMin = totalMin ? totalCS / totalMin : 0;
  const dmgMin = totalMin ? totalDmgToChamps / totalMin : 0;
  const avgMin = games ? totalMin / games : 0;

  return {
    games,
    kills,
    deaths,
    assists,
    kda: Number(kda.toFixed(2)),
    csMin: Number(csMin.toFixed(2)),
    dmgMin: Number(dmgMin.toFixed(0)),
    avgMin: Number(avgMin.toFixed(2)),
    _totalMin: totalMin,
  };
}

function buildLeaderboards(players) {
  const byDesc = (key) =>
    [...players].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, 5);

  const byAsc = (key) =>
    [...players]
      .sort((a, b) => (a[key] ?? Number.POSITIVE_INFINITY) - (b[key] ?? Number.POSITIVE_INFINITY))
      .slice(0, 5);

  return {
    kda: [...players].sort((a, b) => b.kda - a.kda).slice(0, 5),
    kills: byDesc("kills"),
    deaths: byDesc("deaths"),
    assists: byDesc("assists"),
    csMin: byDesc("csMin"),
    dmgMin: byDesc("dmgMin"),
    avgMin: byAsc("avgMin"), // plus petit = meilleur
  };
}

function computeTopChampions(matches, puuid) {
  const map = new Map();

  for (const m of matches) {
    const info = m?.info;
    if (!info) continue;

    const p = info.participants?.find(x => x.puuid === puuid);
    if (!p) continue;

    const champ = p.championName || "Unknown";
    const cur = map.get(champ) || { games: 0, wins: 0 };
    cur.games += 1;
    if (p.win) cur.wins += 1;
    map.set(champ, cur);
  }

  return [...map.entries()]
    .map(([name, v]) => ({
      name,
      games: v.games,
      winRate: v.games ? (v.wins / v.games) * 100 : 0,
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);
}

// ------------------- Elo sorting -------------------
const TIER_ORDER = {
  UNRANKED: 0, IRON: 1, BRONZE: 2, SILVER: 3, GOLD: 4,
  PLATINUM: 5, EMERALD: 6, DIAMOND: 7, MASTER: 8, GRANDMASTER: 9, CHALLENGER: 10
};
const DIV_ORDER = { IV: 1, III: 2, II: 3, I: 4 };

function eloScore(tier, division, lp) {
  const t = TIER_ORDER[tier] ?? 0;
  const d = DIV_ORDER[division] ?? 0;
  const p = Number.isFinite(Number(lp)) ? Number(lp) : 0;
  return t * 100000 + d * 1000 + p;
}

// ------------------- Cache mémoire -------------------
let statsCache = { ts: 0, data: null };
let eloCache = { ts: 0, data: null };

// ------------------- API -------------------
app.get("/api/stats", async (_, res) => {
  const now = Date.now();

  if (statsCache.data && (now - statsCache.ts) < TTL_STATS_MS) {
    return res.json({ cached: true, ...statsCache.data });
  }

  try {
    const players = [];
    let totalGamesAll = 0;
    let totalMinAll = 0;

    for (const pl of PLAYERS) {
      const puuid = await getPuuid(pl.gameName, pl.tagLine);
      const ids = await getQueueMatchIds(puuid, SAMPLE_MATCHES_PER_PLAYER);

      const matches = [];
      for (const id of (ids || [])) {
        matches.push(await getMatch(id));
        await sleep(25);
      }

      const base = computeBaseStats(matches, puuid);

      totalGamesAll += base.games || 0;
      totalMinAll += base._totalMin || 0;

      const { _totalMin, ...publicBase } = base;

      players.push({
        id: pl.id,
        name: pl.display,
        ...publicBase,
      });

      await sleep(120);
    }

    const avgGameMinGlobal = totalGamesAll ? (totalMinAll / totalGamesAll) : 0;

    const result = {
      generatedAt: now,
      samplePerPlayer: SAMPLE_MATCHES_PER_PLAYER,
      players,
      leaderboards: buildLeaderboards(players),
      queueId: QUEUE_ID,
      matchFromUnix: MATCH_FROM_UNIX,
      avgGameMin: Number(avgGameMinGlobal.toFixed(2)),
    };

    statsCache = { ts: now, data: result };
    res.json(result);
  } catch (e) {
    if (statsCache.data && (e?.code === "RATE_LIMIT" || String(e?.message).includes("RATE_LIMIT"))) {
      return res.json({ cached: "stale", ...statsCache.data });
    }
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/elo", async (_, res) => {
  const now = Date.now();

  if (eloCache.data && (now - eloCache.ts) < TTL_ELO_MS) {
    return res.json({ cached: true, ...eloCache.data });
  }

  try {
    const out = [];

    for (const pl of PLAYERS) {
      const puuid = await getPuuid(pl.gameName, pl.tagLine);

      const entries = await getLeagueEntriesByPuuid(puuid);
      const queueType = (QUEUE_ID === 440) ? "RANKED_FLEX_SR" : "RANKED_SOLO_5x5";
      const entry = Array.isArray(entries) ? entries.find(e => e.queueType === queueType) : null;

      const wins = entry?.wins ?? 0;
      const losses = entry?.losses ?? 0;
      const games = wins + losses;
      const winRate = games ? (wins / games) * 100 : 0;

      const champIds = await getQueueMatchIds(puuid, TOP_CHAMPS_MATCHES_PER_PLAYER);
      const champMatches = [];
      for (const id of (champIds || [])) {
        champMatches.push(await getMatch(id));
        await sleep(18);
      }
      const topChampions = computeTopChampions(champMatches, puuid);

      out.push({
        id: pl.id,
        name: pl.display,
        tier: entry?.tier || "UNRANKED",
        division: entry?.rank || "",
        lp: entry?.leaguePoints ?? 0,
        queueRankText: entry ? `${entry.tier} ${entry.rank}` : "Unranked",
        wins, losses, games,
        winRate: Number(winRate.toFixed(2)),
        topChampions,
      });

      await sleep(120);
    }

    out.sort((a, b) => eloScore(b.tier, b.division, b.lp) - eloScore(a.tier, a.division, a.lp));

    const result = { generatedAt: now, players: out, queueId: QUEUE_ID, matchFromUnix: MATCH_FROM_UNIX };
    eloCache = { ts: now, data: result };
    res.json(result);
  } catch (e) {
    if (eloCache.data && (e?.code === "RATE_LIMIT" || String(e?.message).includes("RATE_LIMIT"))) {
      return res.json({ cached: "stale", ...eloCache.data });
    }
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/refresh", (_, res) => {
  statsCache = { ts: 0, data: null };
  eloCache = { ts: 0, data: null };
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`ℹ️ Queue=${QUEUE_ID} (420 SoloQ / 440 Flex)`);
  console.log(`ℹ️ Stats sample: ${SAMPLE_MATCHES_PER_PLAYER} match/player`);
  console.log(`ℹ️ Top champs sample: ${TOP_CHAMPS_MATCHES_PER_PLAYER} match/player`);
  console.log(`ℹ️ Date filter MATCH_FROM_UNIX=${MATCH_FROM_UNIX} (0 = aucun filtre)`);
});
