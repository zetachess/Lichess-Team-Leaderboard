"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChartNoAxesCombined,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  Search,
  Swords,
  Trophy,
  X,
} from "lucide-react";
import NumberTicker from "./number-ticker";
import SparklesTitle from "./sparkles-title";
import { locales, translations, type Language } from "@/lib/translations";

type Player = {
  playerId: string;
  username: string;
  points: number;
  tournaments: number;
};

type RankedPlayer = Player & { rank: number };
type Period = "week" | "all" | "weekly-history";

type BoardData = {
  allTime: Player[];
  thisWeek: Player[];
  updatedAt: string | null;
  coverageFrom: string | null;
  tournamentCount: number;
  weekTournamentCount: number;
  totalPoints: number;
  weekStart: string | null;
  highlights: {
    biggestTournamentPerformance: TournamentHighlight | null;
    mostConsistentPlayer: PlayerInsight | null;
  };
  weeklyHistory: { weekStart: string; weekEnd: string; players: Player[] }[];
};

type PlayerInsight = Player & { rank?: number };
type TournamentHighlight = {
  id: string;
  name: string;
  startAt: string;
  url: string;
  winner: { playerId: string; username: string; points: number; rank: number | null } | null;
  participants: number;
  totalPoints: number;
};

const EMPTY_BOARD: BoardData = {
  allTime: [],
  thisWeek: [],
  updatedAt: null,
  coverageFrom: null,
  tournamentCount: 0,
  weekTournamentCount: 0,
  totalPoints: 0,
  weekStart: null,
  highlights: { biggestTournamentPerformance: null, mostConsistentPlayer: null },
  weeklyHistory: [],
};

function formatPoints(points: number, language: Language) {
  return new Intl.NumberFormat(locales[language], { maximumFractionDigits: 1 }).format(points);
}

function formatDate(value: string | null, language: Language, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return translations[language].pending;
  return new Intl.DateTimeFormat(locales[language], {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  }).format(new Date(value));
}

function formatWeekRange(weekStart: string | null, language: Language) {
  if (!weekStart) return translations[language].currentWeek;
  const start = new Date(`${weekStart}T12:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = new Intl.DateTimeFormat(locales[language], { timeZone: "Europe/Madrid", day: "numeric", month: "short" });
  return `${format.format(start)} – ${format.format(end)} · ${translations[language].madrid}`;
}

function shortDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(locales[language], { timeZone: "Europe/Madrid", day: "numeric", month: "short" }).format(new Date(value));
}

function profileUrl(username: string) {
  return `https://lichess.org/@/${encodeURIComponent(username)}`;
}

function TrophyPodium({ players, language }: { players: Player[]; language: Language }) {
  const t = translations[language];
  const winners = [
    { player: players[1], rank: 2 },
    { player: players[0], rank: 1 },
    { player: players[2], rank: 3 },
  ].filter((winner): winner is { player: Player; rank: number } => Boolean(winner.player));
  if (!players.length) return null;

  return (
    <section className={`trophy-podium trophy-podium--${winners.length}`} aria-label={t.podium}>
      {winners.map(({ player, rank }) => (
        <a className={`podium-place podium-place--${rank}`} href={profileUrl(player.username)} target="_blank" rel="noreferrer" key={player.playerId}>
          <span className="podium-medal" aria-hidden="true"><Image src="/trophy-3d.png" alt="" width={72} height={72} /></span>
          <span className="podium-rank">{t.place(rank)}</span>
          <strong className="podium-player" title={player.username}>{player.username}</strong>
          <span className="podium-points">{formatPoints(player.points, language)} <small>{t.points}</small></span>
          <span className="podium-tournaments">{player.tournaments} {t.tournament(player.tournaments)}</span>
        </a>
      ))}
    </section>
  );
}

function WeeklyHistory({ weeks, language }: { weeks: BoardData["weeklyHistory"]; language: Language }) {
  const t = translations[language];
  return <section className="weekly-history" aria-label={t.weeklyHistoryTitle}>
    <div className="ranking-card__heading"><div><p className="section-kicker">{t.ranking}</p><h2>{t.weeklyHistoryTitle}</h2></div></div>
    {weeks.map((week) => <article className="weekly-history__week" key={week.weekStart}>
      <h3>{shortDate(`${week.weekStart}T12:00:00Z`, language)} – {shortDate(`${week.weekEnd}T12:00:00Z`, language)}</h3>
      <ol>{week.players.map((player) => <li key={player.playerId}><a href={profileUrl(player.username)} target="_blank" rel="noreferrer">{player.username}</a><strong>{formatPoints(player.points, language)} {t.points}</strong></li>)}</ol>
    </article>)}
  </section>;
}

function PeriodTabs({ value, onChange, language }: { value: Period; onChange: (period: Period) => void; language: Language }) {
  const t = translations[language];
  const periods: { value: Period; label: string }[] = [
    { value: "all", label: t.allTime },
    { value: "week", label: t.weeklyTop },
    { value: "weekly-history", label: t.weeklyHistoryTitle },
  ];
  return (
    <div className="period-switch" role="tablist" aria-label={t.rankingPeriod}>
      {periods.map((period, index) => (
        <button
          key={period.value}
          id={`tab-${period.value}`}
          type="button"
          role="tab"
          aria-controls="ranking-panel"
          aria-selected={value === period.value}
          tabIndex={value === period.value ? 0 : -1}
          className={value === period.value ? "is-active" : ""}
          onClick={() => onChange(period.value)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % periods.length;
            else if (event.key === "ArrowLeft") next = (index - 1 + periods.length) % periods.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = periods.length - 1;
            else return;
            event.preventDefault();
            onChange(periods[next].value);
            const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            tabs?.[next]?.focus();
          }}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function PlayerTable({
  title,
  subtitle,
  players,
  totalPlayers,
  emptyMessage,
  language,
}: {
  title: string;
  subtitle: string;
  players: RankedPlayer[];
  totalPlayers: number;
  emptyMessage: string;
  language: Language;
}) {
  const t = translations[language];
  return (
    <section className="ranking-card" aria-label={title}>
      <div className="ranking-card__heading">
        <div>
          <p className="section-kicker">{t.ranking}</p>
          <h2>{title}</h2>
        </div>
        <span className="ranking-card__period">{players.length === totalPlayers ? `${totalPlayers} ${t.players(totalPlayers)}` : t.outOf(players.length, totalPlayers)} <span aria-hidden="true">·</span> {subtitle}</span>
      </div>
      <div className="table-scroll">
        <table className="compact-table">
          <thead>
            <tr>
              <th className="column-rank" scope="col">#</th>
              <th scope="col">{t.player}</th>
              <th className="column-score" scope="col">{t.pointsHeader}</th>
              <th className="column-events" scope="col">{t.tournaments}</th>
            </tr>
          </thead>
          <tbody>
            {players.length === 0 ? (
              <tr><td className="table-empty" colSpan={4}>{emptyMessage}</td></tr>
            ) : players.map((player) => (
              <tr key={player.playerId}>
                <td className={`rank-number${player.rank <= 3 ? ` rank-number--${player.rank}` : ""}`}>
                  {String(player.rank).padStart(2, "0")}
                </td>
                <td className="player-cell">
                  <a href={profileUrl(player.username)} target="_blank" rel="noreferrer" title={t.profile(player.username)}>
                    <span className="player-name">{player.username}</span><ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
                  </a>
                </td>
                <td className="score-cell">
                  <div className="score-value">
                    <strong>{formatPoints(player.points, language)}</strong>
                  </div>
                </td>
                <td className="event-count">{player.tournaments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Records({ highlights, language }: { highlights: BoardData["highlights"]; language: Language }) {
  const t = translations[language];
  const record = highlights.biggestTournamentPerformance;
  const cards = [
    { label: t.singleTournamentRecord, value: record?.winner ? `${formatPoints(record.winner.points, language)} ${t.points}` : t.noInsights, detail: record?.winner ? record.winner.username : "", detailHref: record?.winner ? profileUrl(record.winner.username) : undefined, meta: record?.name ?? "", metaHref: record?.url },
    { label: t.consistencyKing, value: highlights.mostConsistentPlayer ? `${highlights.mostConsistentPlayer.tournaments} ${t.tournament(highlights.mostConsistentPlayer.tournaments)}` : t.noInsights, detail: highlights.mostConsistentPlayer?.username ?? "", detailHref: highlights.mostConsistentPlayer ? profileUrl(highlights.mostConsistentPlayer.username) : undefined, meta: t.mostTournamentsPlayed },
  ];
  return (
    <section className="records-section records-section--two" aria-label={t.records}>
      {cards.map((card, index) => <article className={`record-card record-card--${index + 1}`} key={card.label}>
        <div className="record-card__top"><span className="record-icon"><Trophy size={17} aria-hidden="true" /></span><span>{card.label}</span></div>
        <strong className="record-points">{card.value}</strong>
        {card.detail && (card.detailHref ? <a className="record-player" href={card.detailHref} target="_blank" rel="noreferrer">{card.detail} <ExternalLink size={13} aria-hidden="true" /></a> : <span className="record-player">{card.detail}</span>)}
        {card.meta && (card.metaHref ? <a className="record-event" href={card.metaHref} target="_blank" rel="noreferrer">{card.meta}{record && index === 0 ? ` · ${shortDate(record.startAt, language)}` : ""}</a> : <span className="record-event">{card.meta}</span>)}
      </article>)}
    </section>
  );
}

export default function Leaderboard({ language }: { language: Language }) {
  const t = translations[language];
  const [data, setData] = useState<BoardData>(EMPTY_BOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadBoard = useCallback(async (initial = false) => {
    try {
      const response = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!response.ok) throw new Error("Leaderboard request failed");
      const result = (await response.json()) as BoardData;
      setData(result);
      setError(false);
    } catch {
      setError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadBoard(true), 0);
    const timer = window.setInterval(() => void loadBoard(), 5 * 60 * 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadBoard]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase(language);
  const filterPlayers = (players: Player[]): RankedPlayer[] => players
    .map((player, index) => ({ ...player, rank: index + 1 }))
    .filter((player) => !normalizedSearch
      || player.username.toLocaleLowerCase(language).includes(normalizedSearch)
      || player.playerId.toLocaleLowerCase(language).includes(normalizedSearch));
  const sourcePlayers = period === "week" ? data.thisWeek : data.allTime;
  const players = filterPlayers(sourcePlayers);
  const hasData = Boolean(data.updatedAt || data.allTime.length);

  const stats = [
    { label: t.countedTournaments, value: data.tournamentCount, icon: Swords },
    { label: t.totalPoints, value: data.totalPoints, icon: ChartNoAxesCombined },
  ];

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <nav className="language-switch" aria-label={t.languageLabel}>
          <Link href="/es" lang="es" hrefLang="es" aria-current={language === "es" ? "page" : undefined}>ES</Link>
          <Link href="/" lang="en" hrefLang="en" aria-current={language === "en" ? "page" : undefined}>EN</Link>
          <Link href="/fr" lang="fr" hrefLang="fr" aria-current={language === "fr" ? "page" : undefined}>FR</Link>
        </nav>
        <a className="team-link" href="https://lichess.org/team/colegas-de-kike" target="_blank" rel="noreferrer">
          {t.viewTeam} <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
        </a>
      </header>

      <div className="dashboard-title">
        <div>
          <p className="dashboard-eyebrow"><span className="status-dot" /> {t.teamTournaments}</p>
          <SparklesTitle />
        </div>
        <span className="week-range">{formatWeekRange(data.weekStart, language)}</span>
      </div>

      {error && (
        <div className="dashboard-error" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <span>{t.loadError}</span>
          <button type="button" onClick={() => { setLoading(true); void loadBoard(true); }}><RefreshCw size={15} aria-hidden="true" /> {t.retry}</button>
        </div>
      )}

      {loading ? (
        <div className="dashboard-loading" aria-label={t.loadingLabel}>
          <RefreshCw className="loading-icon" size={19} aria-hidden="true" /> {t.loading}
        </div>
      ) : !hasData && error ? null : (
        <>
          <section className="stats-grid" aria-label={t.summary}>
            {stats.map((stat) => (
              <article className="stat-card" key={stat.label}>
                <stat.icon className="stat-mark" size={21} strokeWidth={1.7} aria-hidden="true" />
                <strong><NumberTicker value={stat.value} language={language} /></strong>
                <span className="stat-label">{stat.label}</span>
              </article>
            ))}
          </section>

          <Records highlights={data.highlights} language={language} />
          <section className="single-ranking" aria-label={t.playerRanking}>
            <PeriodTabs value={period} onChange={setPeriod} language={language} />
            <div id="ranking-panel" role="tabpanel" aria-labelledby={`tab-${period}`}>
              <div className="player-search">
                <div className="search-field">
                  <Search size={18} strokeWidth={1.8} aria-hidden="true" />
                  <label className="visually-hidden" htmlFor="player-search">{t.searchLabel}</label>
                  <input
                    id="player-search"
                    ref={searchRef}
                    type="search"
                    placeholder={t.searchLabel}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setSearchTerm("");
                        event.currentTarget.blur();
                      }
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {searchTerm ? (
                    <button className="search-clear" type="button" onClick={() => { setSearchTerm(""); searchRef.current?.focus(); }} aria-label={t.clearSearch}><X size={16} aria-hidden="true" /></button>
                  ) : (
                    <kbd className="search-shortcut">Ctrl K</kbd>
                  )}
                </div>
                <span className="search-hint">{normalizedSearch ? t.results(players.length) : t.searchHint}</span>
              </div>
              {!normalizedSearch && period !== "weekly-history" && <TrophyPodium players={sourcePlayers.slice(0, 3)} language={language} />}
              {!normalizedSearch && period === "weekly-history" && <WeeklyHistory weeks={data.weeklyHistory} language={language} />}
              {period !== "weekly-history" && <PlayerTable
                title={`${t.playersHeading} · ${period === "week" ? t.weeklyTop : t.allTime}`}
                subtitle={period === "all" ? t.history : `${data.weekTournamentCount} ${t.tournament(data.weekTournamentCount)}`}
                players={players}
                totalPlayers={sourcePlayers.length}
                emptyMessage={normalizedSearch
                  ? t.noMatches
                  : period === "all" ? t.noHistory : t.noWeek}
                language={language}
              />}
            </div>
          </section>
        </>
      )}

      <footer className="dashboard-footer">
        <span className="footer-sync"><RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" /> {t.updated} {formatDate(data.updatedAt, language, { hour: "2-digit", minute: "2-digit" })}</span>
        <span>{t.coverage} {formatDate(data.coverageFrom, language)}</span>
        <span>{t.weekTimezone}</span>
      </footer>
    </main>
  );
}
