import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLichessClient, parseRecords } from "../lib/lichess.mjs";
import { createEmptyDataset, readDataset, writeDataset } from "../lib/leaderboard-store.mjs";
import { syncLeaderboard } from "../scripts/sync-leaderboard.mjs";

const quietLogger = { log() {}, warn() {}, error() {} };

test("Lichess parsing handles NDJSON", () => {
  assert.deepEqual(parseRecords(['{"id":"one"}', '{"id":"two"}'].join(String.fromCharCode(10))), [
    { id: "one" },
    { id: "two" },
  ]);
});

test("Lichess client builds encoded team requests", async () => {
  let requestedUrl;
  const client = createLichessClient({
    teamId: "team name",
    tournamentHistoryLimit: 50,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response('{"id":"event1","status":30}' + String.fromCharCode(10), { status: 200 });
    },
  });
  assert.deepEqual(await client.getTournamentList("arena"), [{ id: "event1", status: 30 }]);
  assert.equal(requestedUrl, "https://lichess.org/api/team/team%20name/arena?max=50");
});

test("Lichess client uses the official Arena results API and keeps only the configured team", async () => {
  let requestedUrl;
  let requestedAccept;
  const client = createLichessClient({
    teamId: "Our-Team",
    tournamentHistoryLimit: 50,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedAccept = options.headers.Accept;
      return new Response([
        '{"rank":2,"score":20,"username":"Ana","team":"other-team"}',
        '{"rank":4,"score":15,"username":"Bea","team":"our-team"}',
        '{"rank":8,"score":9,"username":"Carlos","team":"Our-Team"}',
      ].join(String.fromCharCode(10)), { status: 200 });
    },
  });

  assert.deepEqual(await client.getTournamentResults("arena", "event/id"), [
    { playerId: "bea", username: "Bea", points: 15, rank: 1 },
    { playerId: "carlos", username: "Carlos", points: 9, rank: 2 },
  ]);
  assert.equal(requestedUrl, "https://lichess.org/api/tournament/event%2Fid/results?nb=10000");
  assert.equal(requestedAccept, "application/x-ndjson, application/json");
});

test("Lichess client retries temporary forbidden responses", async () => {
  let requests = 0;
  const waits = [];
  const client = createLichessClient({
    teamId: "colegas-de-kike",
    tournamentHistoryLimit: 100,
    fetchImpl: async () => {
      requests += 1;
      if (requests < 3) return new Response("blocked", { status: 403 });
      return new Response('{"id":"arena-1","status":30}\n', { status: 200 });
    },
    sleepImpl: async (delay) => waits.push(delay),
  });

  const events = await client.getTournamentList("arena");
  assert.equal(requests, 3);
  assert.deepEqual(waits, [5_000, 10_000]);
  assert.equal(events[0].id, "arena-1");
});

test("dataset storage preserves corrupt files and round-trips atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "leaderboard-store-"));
  const filePath = path.join(directory, "nested", "data.json");
  const dataset = createEmptyDataset("team-slug");
  try {
    assert.deepEqual(await readDataset(filePath, "team-slug"), dataset);
    await writeDataset(filePath, dataset);
    assert.deepEqual(await readDataset(filePath, "team-slug"), dataset);
    await writeFile(filePath, "{broken", "utf8");
    await assert.rejects(readDataset(filePath, "team-slug"), SyntaxError);
    assert.equal(await readFile(filePath, "utf8"), "{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("syncLeaderboard imports completed tournaments using injected dependencies", async () => {
  const dataset = createEmptyDataset("team-slug");
  const savedSnapshots = [];
  const client = {
    async getTournamentList(type) {
      assert.equal(type, "arena");
      return [
        { id: "finished", status: 30, startsAt: "2026-10-14T18:00:00Z", name: "Finished event" },
        { id: "running", status: 20, startsAt: "2026-10-14T19:00:00Z", name: "Running event" },
      ];
    },
    async getTournamentResults(type, id) {
      assert.equal(type, "arena");
      assert.equal(id, "finished");
      return [{ playerId: "ana", username: "Ana", points: 12, rank: 1 }];
    },
  };
  const result = await syncLeaderboard({
    teamId: "team-slug",
    tournamentHistoryLimit: 10,
    outputPath: "/tmp/leaderboard.json",
    client,
    read: async () => dataset,
    write: async (_filePath, value) => savedSnapshots.push(structuredClone(value)),
    logger: quietLogger,
    now: () => new Date("2026-10-15T06:00:00.000Z"),
  });
  assert.equal(result.failed, false);
  assert.equal(result.dataset.tournaments.length, 1);
  assert.equal(result.dataset.tournaments[0].id, "arena:finished");
  assert.equal(result.dataset.tournaments[0].results[0].points, 12);
  assert.equal(result.dataset.updatedAt, "2026-10-15T06:00:00.000Z");
  assert.equal(savedSnapshots.length, 2);
});

test("syncLeaderboard does not record a tournament with empty team results", async () => {
  const dataset = {
    team: "colegas-de-kike",
    updatedAt: "2026-10-19T00:00:00.000Z",
    coverageFrom: null,
    unavailableTournamentIds: [],
    tournaments: [],
  };
  const client = {
    async getTournamentList() {
      return [{ id: "empty", status: 30, startsAt: "2026-10-20T18:00:00.000Z" }];
    },
    async getTournamentResults() {
      return [];
    },
  };

  const result = await syncLeaderboard({
    client,
    read: async () => dataset,
    write: async () => {},
    logger: { log() {}, warn() {}, error() {} },
    now: () => new Date("2026-10-20T20:00:00.000Z"),
  });

  assert.equal(result.failed, true);
  assert.equal(result.dataset.tournaments.length, 0);
  assert.equal(result.dataset.updatedAt, "2026-10-19T00:00:00.000Z");
});
