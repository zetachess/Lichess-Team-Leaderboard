import { NextResponse } from "next/server";
import { rankPlayers } from "../../../lib/leaderboard.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const leaderboardUrl = "https://raw.githubusercontent.com/zetachess/Lichess-Team-Leaderboard/leaderboard-data/data/leaderboard.json";

type TournamentResult = {
  playerId: string;
  username: string;
  points: number;
  rank: number | null;
};

type Tournament = {
  id: string;
  type: "arena" | "swiss";
  name: string;
  startAt: string;
  url: string;
  results: TournamentResult[];
};

type Dataset = {
  team: string;
  updatedAt: string | null;
  coverageFrom: string | null;
  unavailableTournamentIds?: string[];
  tournaments: Tournament[];
};

async function loadDataset(): Promise<Dataset> {
  const response = await fetch(leaderboardUrl + "?v=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo leer el archivo de puntos (${response.status}).`);
  const dataset = (await response.json()) as Dataset;
  if (dataset.team !== "colegas-de-kike" || !Array.isArray(dataset.tournaments)) {
    throw new Error("El archivo público de puntos no tiene el formato esperado.");
  }
  return dataset;
}

export async function GET() {
  try {
    const dataset = await loadDataset();
    const now = new Date();
    const allTime = rankPlayers(dataset, "all", now);
    const thisWeek = rankPlayers(dataset, "week", now);
    const results = dataset.tournaments
      .filter((tournament) => tournament.type === "arena")
      .flatMap((tournament) => tournament.results);
    const arenaTournaments = dataset.tournaments.filter((tournament) => tournament.type === "arena");
    const playerStats = new Map<string, { playerId: string; username: string; points: number; tournaments: number }>();
    const tournamentHighlights = arenaTournaments.map((tournament) => {
      const sorted = [...tournament.results].sort((a, b) => b.points - a.points || (a.rank ?? Infinity) - (b.rank ?? Infinity));
      const winner = sorted[0];
      for (const result of tournament.results) {
        const current = playerStats.get(result.playerId) ?? { playerId: result.playerId, username: result.username, points: 0, tournaments: 0 };
        current.username = result.username || current.username;
        current.points += result.points;
        current.tournaments += 1;
        playerStats.set(result.playerId, current);
      }
      return {
        id: tournament.id,
        name: tournament.name,
        startAt: tournament.startAt,
        url: tournament.url,
        winner: winner ? { playerId: winner.playerId, username: winner.username, points: winner.points, rank: winner.rank } : null,
        participants: tournament.results.length,
        totalPoints: tournament.results.reduce((sum, result) => sum + result.points, 0),
      };
    }).sort((a, b) => b.startAt.localeCompare(a.startAt));
    const playerStatsList = [...playerStats.values()];
    const biggestTournamentPerformance = tournamentHighlights
      .filter((tournament) => tournament.winner)
      .sort((a, b) => (b.winner?.points ?? 0) - (a.winner?.points ?? 0))[0] ?? null;

    const response = NextResponse.json({
      allTime: allTime.entries,
      thisWeek: thisWeek.entries,
      updatedAt: dataset.updatedAt,
      coverageFrom: dataset.coverageFrom,
      tournamentCount: allTime.tournamentCount,
      weekTournamentCount: thisWeek.tournamentCount,
      uniquePlayers: new Set(results.map((result) => result.playerId)).size,
      totalPoints: results.reduce((sum, result) => sum + result.points, 0),
      unavailableTournamentCount: dataset.unavailableTournamentIds?.length ?? 0,
      weekStart: thisWeek.weekStart,
      highlights: {
        biggestTournamentPerformance,
        mostConsistentPlayer: [...playerStatsList].sort((a, b) => b.tournaments - a.tournaments || b.points - a.points)[0] ?? null,
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Leaderboard read failed", error);
    return NextResponse.json({ error: "No se pudo cargar la clasificación." }, { status: 503 });
  }
}
