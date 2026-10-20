const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseRecords(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Tournament lists and results are normally newline-delimited JSON.
    }
  }
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function parseDate(value) {
  if (typeof value === "number") {
    const date = new Date(value < 10_000_000_000 ? value * 1_000 : value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function tournamentStart(event) {
  return parseDate(event.startsAt ?? event.startAt ?? event.startDate ?? event.createdAt);
}

export function isFinished(event) {
  const status = String(event.status ?? "").toLowerCase();
  // Lichess encodes tournament state as 10 (created), 20 (started), 30 (finished).
  return status === "finished" || Number(event.status) === 30 || event.finished === true;
}

export function normalizePlayer(row) {
  const rawUsername = row.username ?? row.user?.name ?? row.user?.username ?? row.name;
  if (typeof rawUsername !== "string" || !rawUsername.trim()) return null;

  const username = rawUsername.trim();
  const rawPoints = row.score ?? row.points ?? row.point;
  const points = Number(rawPoints);
  if (!Number.isFinite(points)) return null;

  const rank = Number(row.rank);
  return {
    playerId: username.toLowerCase(),
    username,
    points,
    rank: Number.isFinite(rank) && rank > 0 ? rank : null,
  };
}

export function createLichessClient({
  teamId,
  tournamentHistoryLimit,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  async function fetchText(url, accept = "application/x-ndjson, application/json", timeoutMs = 45_000) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchImpl(url, {
        headers: {
          Accept: accept,
          "User-Agent": "lichess-team-leaderboard/1.0",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const retryable = response.status === 403
        || response.status === 408
        || response.status === 425
        || response.status === 429
        || response.status >= 500;
      if (retryable && attempt < 3) {
        const retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
        const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1_000
          : Math.min(2 ** attempt * 5_000, 60_000);
        console.warn("Lichess returned " + response.status + "; retrying after " + delay + " ms.");
        await sleepImpl(delay);
        continue;
      }
      if (!response.ok) throw new Error("Lichess returned " + response.status + " for " + url);
      return response.text();
    }
    throw new Error("Lichess request retries exhausted: " + url);
  }

  async function getTournamentList(type) {
    const endpoint = type === "arena" ? "arena" : "swiss";
    const url = "https://lichess.org/api/team/" + encodeURIComponent(teamId) + "/" + endpoint
      + "?max=" + encodeURIComponent(tournamentHistoryLimit);
    const body = await fetchText(url, "application/x-ndjson, application/json", 600_000);
    return parseRecords(body);
  }

  async function getTournamentResults(type, id) {
    if (type === "arena") {
      // The official results API includes the team slug for every player in a
      // Team Battle. Filtering that stream is more stable than scraping the
      // tournament HTML page, which can reject automated requests with 403.
      const body = await fetchText(
        "https://lichess.org/api/tournament/" + encodeURIComponent(id) + "/results?nb=10000",
        "application/x-ndjson, application/json",
      );
      const normalizedTeamId = teamId.toLowerCase();
      return parseRecords(body)
        .filter((row) => typeof row.team === "string" && row.team.toLowerCase() === normalizedTeamId)
        .map(normalizePlayer)
        .filter(Boolean)
        .map((player, index) => ({ ...player, rank: index + 1 }));
    }

    const body = await fetchText("https://lichess.org/api/swiss/" + encodeURIComponent(id) + "/results");
    const rows = parseRecords(body);
    const players = new Map();
    for (const row of rows) {
      const player = normalizePlayer(row);
      if (!player) continue;
      const current = players.get(player.playerId);
      if (!current || player.points > current.points) players.set(player.playerId, player);
    }
    return [...players.values()];
  }

  return { getTournamentList, getTournamentResults };
}
