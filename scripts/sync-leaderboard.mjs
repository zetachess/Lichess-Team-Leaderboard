import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLichessClient, isFinished, tournamentStart } from "../lib/lichess.mjs";
import { readDataset, writeDataset } from "../lib/leaderboard-store.mjs";
import { upsertTournament } from "../lib/leaderboard.mjs";

export async function syncLeaderboard({
  teamId = process.env.LICHESS_TEAM_ID || "colegas-de-kike",
  // Lichess returns the newest tournaments first. The saved dataset retains
  // the complete imported history, so routine runs only need a recent window.
  // Raise LICHESS_TOURNAMENT_LIMIT explicitly when rebuilding older history.
  tournamentHistoryLimit = Number(process.env.LICHESS_TOURNAMENT_LIMIT || 100),
  // New runs normally have only a few tournaments to import. Keep this low to
  // respect Lichess rate limits while still allowing a gradual backfill.
  resultConcurrency = Number(process.env.LICHESS_RESULT_CONCURRENCY || 2),
  outputPath = process.env.LEADERBOARD_DATA_PATH || path.resolve("data/leaderboard.json"),
  client = createLichessClient({ teamId, tournamentHistoryLimit }),
  read = readDataset,
  write = writeDataset,
  logger = console,
  now = () => new Date(),
} = {}) {
  if (!Number.isInteger(tournamentHistoryLimit) || tournamentHistoryLimit < 1) {
    throw new Error("LICHESS_TOURNAMENT_LIMIT must be a positive integer.");
  }
  if (!Number.isInteger(resultConcurrency) || resultConcurrency < 1) {
    throw new Error("LICHESS_RESULT_CONCURRENCY must be a positive integer.");
  }

  const dataset = await read(outputPath, teamId);
  dataset.team = teamId;
  dataset.tournaments = dataset.tournaments.filter((tournament) => tournament.type === "arena");

  const knownIds = new Set(dataset.tournaments.map((tournament) => tournament.id));
  dataset.unavailableTournamentIds = Array.isArray(dataset.unavailableTournamentIds)
    ? dataset.unavailableTournamentIds
    : [];
  for (const id of dataset.unavailableTournamentIds) knownIds.add(id);

  let failed = false;
  let completedLists = 0;

  for (const type of ["arena"]) {
    let events;
    try {
      events = await client.getTournamentList(type);
      completedLists += 1;
    } catch (error) {
      failed = true;
      logger.error("Could not list " + type + " tournaments:", error);
      continue;
    }

    const candidates = [];
    for (const event of events) {
      const lichessId = event.id ?? event.tournament?.id;
      if (!lichessId || !isFinished(event)) continue;

      const compositeId = type + ":" + lichessId;
      if (knownIds.has(compositeId)) continue;

      const startAt = tournamentStart(event);
      if (!startAt) {
        failed = true;
        logger.error("Skipping " + compositeId + ": Lichess did not provide a usable start date.");
        continue;
      }

      candidates.push({ event, lichessId, compositeId, startAt });
    }

    for (let offset = 0; offset < candidates.length; offset += resultConcurrency) {
      const batch = candidates.slice(offset, offset + resultConcurrency);
      const imported = await Promise.allSettled(batch.map(async ({ event, lichessId, compositeId, startAt }) => {
        const results = await client.getTournamentResults(type, lichessId);
        if (results.length === 0) {
          throw new Error("Lichess returned no team results for " + compositeId + ".");
        }
        const name = String(event.name ?? event.fullName ?? event.tournament?.name ?? "Torneo de Colegas de Kike");
        return { compositeId, lichessId, type, name, startAt, results };
      }));

      for (let index = 0; index < imported.length; index += 1) {
        const outcome = imported[index];
        const { compositeId } = batch[index];
        if (outcome.status === "fulfilled") {
          const importedTournament = outcome.value;
          upsertTournament(dataset, {
            id: importedTournament.compositeId,
            lichessId: importedTournament.lichessId,
            type: importedTournament.type,
            name: importedTournament.name,
            startAt: importedTournament.startAt,
            url: "https://lichess.org/tournament/" + encodeURIComponent(importedTournament.lichessId),
            results: importedTournament.results,
          });
          knownIds.add(compositeId);
          logger.log("Imported " + compositeId + ": " + importedTournament.results.length + " players.");
          continue;
        }

        const error = outcome.reason;
        if (error instanceof Error && error.message.includes("Lichess returned 404")) {
          // Some old team Arena listings outlive the official results endpoint.
          // Record them once so scheduled syncs do not retry permanently missing data.
          dataset.unavailableTournamentIds.push(compositeId);
          knownIds.add(compositeId);
          logger.warn("Historical results unavailable for " + compositeId + "; recorded as missing.");
        } else {
          failed = true;
          logger.error("Could not import " + compositeId + ":", error);
        }
      }

      // Persist after each concurrent batch so a timeout resumes from the
      // last completed batch instead of losing the entire backfill.
      dataset.coverageFrom = dataset.tournaments[0]?.startAt ?? null;
      await write(outputPath, dataset);
    }
  }

  if (completedLists === 1 && !failed) dataset.updatedAt = now().toISOString();
  dataset.coverageFrom = dataset.tournaments[0]?.startAt ?? null;
  await write(outputPath, dataset);
  logger.log(
    "Saved " + dataset.tournaments.length + " tournaments; "
      + dataset.unavailableTournamentIds.length
      + " historical results unavailable; sync status: " + (failed ? "partial" : "complete") + ".",
  );
  return { dataset, failed };
}

const currentScript = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (currentScript === import.meta.url) {
  const { failed } = await syncLeaderboard();
  if (failed) process.exitCode = 1;
}
