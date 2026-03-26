"use client";

import {
  FormEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { ColorPicker, type IColor } from "react-color-palette";
import "react-color-palette/css";

import Member from "@/lib/components/member";
import type { TeamMember } from "@/lib/components/team";
import { getClientFirestore } from "@/lib/firebase/client";
import type { RoomRosterTeam } from "./room-layout-types";

type RosterCard = {
  id: string;
  memberId?: string | null;
  name: string;
  teamName?: string;
  teamId?: string | null;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  muted?: boolean;
};

const UNASSIGNED_DROP_ZONE = "__unassigned__";

type RoomLobbyLayoutProps = {
  roomTitle: string;
  headerKicker: string;
  headerDescription: string;
  statusTitle: string;
  statusBody: string;
  hostMissingMessage: string;
  host: TeamMember | null;
  teams: RoomRosterTeam[];
  rosterCards: RosterCard[];
  roomSlug: string;
  isHost: boolean;
  showScores?: boolean;
  onStart?: () => void;
  isStartDisabled?: boolean;
  allowTeamEditing?: boolean;
  allowReshuffle?: boolean;
  viewerTeamId?: string | null;
  renderTeamScoreAction?: (team: RoomRosterTeam) => ReactNode;
  allowScoreActionForAllTeams?: boolean;
};

const TEAM_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#f472b6",
  "#8b5cf6",
  "#06b6d4",
  "#ef4444",
  "#10b981",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function hexToRgb(hex: string): { r: number; g: number; b: number, a: number } {
  const parsed = hex.replace("#", "");
  const value = parsed.length === 3
    ? parsed.split("").map((c) => c + c).join("")
    : parsed.padEnd(6, "0").slice(0, 6);
  const num = parseInt(value, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
    a: 255,
  };
}

function rgbToHsv(r: number, g: number, b: number) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
    else if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
    else h = (rNorm - gNorm) / delta + 4;
  }
  h = (h * 60 + 360) % 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

function toColor(hex: string): IColor {
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  return {
    hex,
    rgb,
    hsv: { ...hsv, a: 1 },
  };
}

function withAlpha(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function RoomLobbyLayout({
  roomTitle,
  headerKicker,
  headerDescription,
  statusTitle,
  statusBody,
  hostMissingMessage,
  host,
  teams,
  rosterCards,
  roomSlug,
  isHost,
  showScores = false,
  onStart,
  isStartDisabled = false,
  allowTeamEditing = true,
  allowReshuffle = false,
  viewerTeamId = null,
  renderTeamScoreAction,
  allowScoreActionForAllTeams = false,
}: RoomLobbyLayoutProps) {
  const teamColorMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((team, index) => {
      const explicitColor = (team.color as string | undefined) ?? undefined;
      const paletteIndex =
        Math.abs(hashString(team.id ?? `${team.name}-${index}`)) % TEAM_COLORS.length;
      map.set(team.id, explicitColor ?? TEAM_COLORS[paletteIndex]);
    });
    return map;
  }, [teams]);

  const getColorForTeam = (teamId?: string | null) => {
    if (!teamId) return "#d4d4d8";
    return teamColorMap.get(teamId) ?? "#d4d4d8";
  };

  const suggestedColor = useMemo(() => {
    const used = new Set(
      teams
        .map((team) => team.color)
        .filter((color): color is string => Boolean(color?.trim()))
    );
    const firstUnused = TEAM_COLORS.find((color) => !used.has(color));
    return firstUnused ?? TEAM_COLORS[0];
  }, [teams]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState<IColor>(toColor(suggestedColor));
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{
    id: string;
    name: string;
    currentTeamId: string | null;
  } | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [isReshuffling, setIsReshuffling] = useState(false);
  const [reshuffleError, setReshuffleError] = useState<string | null>(null);
  const [draggedMemberId, setDraggedMemberId] = useState<string | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const hasTeams = teams.length > 0;
  const rosterByTeamId = useMemo(() => {
    const next = new Map<string | null, RosterCard[]>();
    rosterCards.forEach((card) => {
      const key = card.teamId ?? null;
      const cards = next.get(key);
      if (cards) {
        cards.push(card);
      } else {
        next.set(key, [card]);
      }
    });
    return next;
  }, [rosterCards]);
  const unassignedRosterCards = rosterByTeamId.get(null) ?? [];
  const isDragEnabled = isHost && allowTeamEditing;

  useEffect(() => {
    setNewTeamColor(toColor(suggestedColor));
  }, [suggestedColor]);

  const openCreateModal = () => {
    if (!isHost || !allowTeamEditing) return;
    setEditingTeamId(null);
    setNewTeamName("");
    setNewTeamColor(toColor(suggestedColor));
    setTeamError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (team: RoomRosterTeam) => {
    if (!isHost || !allowTeamEditing) return;
    setEditingTeamId(team.id);
    setNewTeamName(team.name ?? "");
    setNewTeamColor(toColor(team.color ?? suggestedColor));
    setTeamError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSavingTeam) return;
    if (statusTitle.toLowerCase().includes("ended")) return;
    setIsModalOpen(false);
  };

  async function handleCreateTeam(event: FormEvent) {
    event.preventDefault();
    if (isSavingTeam || !allowTeamEditing || !isHost) return;
    if (!newTeamName.trim()) {
      setTeamError("Team name is required.");
      return;
    }

    try {
      setIsSavingTeam(true);
      setTeamError(null);
      const db = getClientFirestore();
      if (editingTeamId) {
        await updateDoc(doc(db, "rooms", roomSlug, "teams", editingTeamId), {
          name: newTeamName.trim(),
          color: newTeamColor.hex,
        });
      } else {
        await addDoc(collection(db, "rooms", roomSlug, "teams"), {
          name: newTeamName.trim(),
          color: newTeamColor.hex,
          createdAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error("[team-create]", error);
      setTeamError("Unable to create team right now.");
    } finally {
      setIsSavingTeam(false);
    }
  }

  async function handleDeleteTeam(team: RoomRosterTeam) {
    if (deletingTeamId || !allowTeamEditing || !isHost) return;
    setDeletingTeamId(team.id);
    setTeamError(null);
    try {
      const db = getClientFirestore();
      const batch = writeBatch(db);
      const membersRef = collection(db, "rooms", roomSlug, "members");
      const snapshot = await getDocs(query(membersRef, where("team", "==", team.id)));
      snapshot.docs.forEach((memberDoc) => {
        batch.update(memberDoc.ref, { team: null });
      });
      batch.delete(doc(db, "rooms", roomSlug, "teams", team.id));
      await batch.commit();
    } catch (error) {
      console.error("[team-delete]", error);
      setTeamError("Unable to delete team right now.");
    } finally {
      setDeletingTeamId(null);
    }
  }

  async function assignMemberToTeam(memberId: string, teamId: string | null) {
    if (!allowTeamEditing || !isHost || isAssigning) return false;
    try {
      setIsAssigning(true);
      setAssignError(null);
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug, "members", memberId), {
        team: teamId,
      });
      return true;
    } catch (error) {
      console.error("[team-assign]", error);
      setAssignError("Unable to update member right now.");
      return false;
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleAssignTeam(teamId: string | null) {
    if (!assignTarget) return;
    const didAssign = await assignMemberToTeam(assignTarget.id, teamId);
    if (didAssign) {
      setAssignTarget(null);
    }
  }

  const clearDragState = () => {
    setDraggedMemberId(null);
    setActiveDropZone(null);
  };

  const handleMemberDragStart = (event: ReactDragEvent<HTMLDivElement>, card: RosterCard) => {
    if (!isDragEnabled || !card.memberId) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.memberId);
    setDraggedMemberId(card.memberId);
    setAssignError(null);
  };

  const handleDropZoneDragOver = (
    event: ReactDragEvent<HTMLElement>,
    targetTeamId: string | null
  ) => {
    if (!isDragEnabled || !draggedMemberId) return;
    const draggedCard = rosterCards.find((card) => card.memberId === draggedMemberId);
    if (!draggedCard || (draggedCard.teamId ?? null) === targetTeamId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setActiveDropZone(targetTeamId ?? UNASSIGNED_DROP_ZONE);
  };

  const handleDropZoneDragLeave = (
    event: ReactDragEvent<HTMLElement>,
    targetTeamId: string | null
  ) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    if (activeDropZone === (targetTeamId ?? UNASSIGNED_DROP_ZONE)) {
      setActiveDropZone(null);
    }
  };

  const handleDropOnZone = async (
    event: ReactDragEvent<HTMLElement>,
    targetTeamId: string | null
  ) => {
    event.preventDefault();
    const memberId = event.dataTransfer.getData("text/plain") || draggedMemberId;
    clearDragState();

    if (!isDragEnabled || !memberId) return;
    const draggedCard = rosterCards.find((card) => card.memberId === memberId);
    if (!draggedCard || (draggedCard.teamId ?? null) === targetTeamId) return;

    await assignMemberToTeam(memberId, targetTeamId);
  };

  async function handleReshuffle() {
    if (!allowReshuffle || !allowTeamEditing || !isHost || isReshuffling) return;
    if (!teams.length) {
      setReshuffleError("Create at least one team before reshuffling.");
      return;
    }
    const memberIds = rosterCards
      .map((card) => card.memberId)
      .filter((id): id is string => Boolean(id));
    if (!memberIds.length) {
      setReshuffleError("No players available to reshuffle.");
      return;
    }

    try {
      setIsReshuffling(true);
      setReshuffleError(null);
      const db = getClientFirestore();
      const shuffled = [...memberIds];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const batch = writeBatch(db);
      shuffled.forEach((memberId, index) => {
        const teamId = teams[index % teams.length]?.id ?? null;
        if (!teamId) return;
        batch.update(doc(db, "rooms", roomSlug, "members", memberId), { team: teamId });
      });
      await batch.commit();
    } catch (error) {
      console.error("[team-reshuffle]", error);
      setReshuffleError("Unable to reshuffle right now.");
    } finally {
      setIsReshuffling(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col overflow-hidden bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-6 dark:from-black dark:via-zinc-950 dark:to-zinc-900">
      <header className="flex flex-col gap-2 text-center sm:text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500 dark:text-emerald-300">
          {headerKicker}
        </p>
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-white">{roomTitle}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{headerDescription}</p>
      </header>

      <main className="mt-5 grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          className={[
            "grid min-h-0 gap-6",
            hasTeams ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)]",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <section className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
                  Everyone in the lobby
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isHost && allowTeamEditing ? (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    + Create team
                  </button>
                ) : null}
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                  {unassignedRosterCards.length}
                </span>
              </div>
            </div>

            <div
              className={[
                "min-h-0 flex-1 rounded-2xl transition",
                isDragEnabled && activeDropZone === UNASSIGNED_DROP_ZONE
                  ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-transparent"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={
                isDragEnabled ? (event) => handleDropZoneDragOver(event, null) : undefined
              }
              onDragLeave={
                isDragEnabled ? (event) => handleDropZoneDragLeave(event, null) : undefined
              }
              onDrop={isDragEnabled ? (event) => void handleDropOnZone(event, null) : undefined}
            >
              {unassignedRosterCards.length ? (
                <div className="flex h-full flex-wrap content-start justify-center gap-3 overflow-auto p-1">
                  {unassignedRosterCards.map((card) => {
                    const isDragging = draggedMemberId === card.memberId;
                    return (
                      <div
                        key={card.id}
                        className={[
                          "relative w-full min-w-[240px] max-w-[320px] sm:w-[calc(50%-0.375rem)] lg:w-[calc(33.333%-0.5rem)] xl:w-[calc(25%-0.5625rem)]",
                          isDragging ? "opacity-40" : "",
                          isDragEnabled && card.memberId ? "cursor-grab active:cursor-grabbing" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        draggable={isDragEnabled && Boolean(card.memberId)}
                        onDragStart={(event) => handleMemberDragStart(event, card)}
                        onDragEnd={clearDragState}
                      >
                        <Member
                          name={card.name}
                          muted={card.muted ?? false}
                          audioTrack={card.audioTrack}
                          videoTrack={card.videoTrack}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full min-h-[180px] w-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-6 py-10 text-center text-sm text-zinc-600 shadow-inner dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                  Everyone has been assigned to a team.
                </div>
              )}
            </div>
          </section>

          {hasTeams ? (
            <section className="flex flex-col">
              <div className="min-h-0 flex-1 pr-1">
                <div className="grid gap-4 xl:grid-cols-2">
                  {teams.map((team) => {
                    const teamColor = getColorForTeam(team.id);
                    const teamRosterCards = rosterByTeamId.get(team.id) ?? [];
                    const isTeamDropActive = activeDropZone === team.id;
                    return (
                      <section
                        key={team.id}
                        className={[
                          "relative rounded-[28px] border p-4 pt-8 shadow-md transition",
                          isDragEnabled && isTeamDropActive
                            ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-transparent"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{
                          borderColor: withAlpha(teamColor, 0.4),
                          background: `linear-gradient(180deg, ${withAlpha(teamColor, 0.18)} 0%, ${withAlpha(teamColor, 0.06)} 100%)`,
                        }}
                        onDragOver={
                          isDragEnabled
                            ? (event) => handleDropZoneDragOver(event, team.id)
                            : undefined
                        }
                        onDragLeave={
                          isDragEnabled
                            ? (event) => handleDropZoneDragLeave(event, team.id)
                            : undefined
                        }
                        onDrop={
                          isDragEnabled
                            ? (event) => void handleDropOnZone(event, team.id)
                            : undefined
                        }
                      >
                        <div className="absolute left-4 top-0 -translate-y-1/2">
                          <div
                            className="flex items-center gap-2 rounded-lg border px-4 py-1 shadow-sm"
                            style={{
                              borderColor: withAlpha(teamColor, 0.45),
                              backgroundColor: teamColor,
                              color: "#ffffff",
                            }}
                          >
                            <span className="text-sm font-semibold tracking-[0.24em]">
                              {team.name}
                            </span>
                            {showScores ? (
                              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold tracking-normal">
                                {team.scoreTotal ?? 0}
                              </span>
                            ) : null}
                            {renderTeamScoreAction &&
                            (allowScoreActionForAllTeams || isHost || viewerTeamId === team.id)
                              ? renderTeamScoreAction(team)
                              : null}
                          </div>
                        </div>

                        {isHost && allowTeamEditing ? (
                          <div className="absolute right-4 top-0 -translate-y-1/2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditModal(team)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-zinc-700 transition cursor-pointer hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-600"
                                style={{ borderColor: withAlpha(teamColor, 0.35) }}
                                aria-label={`Edit ${team.name}`}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="h-4 w-4"
                                >
                                  <path
                                    d="m 4.5,15.767107 v 3.75 h 3.75 l 11.06,-11.0600002 -3.75,-3.75 z"
                                    id="path1" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteTeam(team)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-red-600 transition cursor-pointer hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-zinc-600"
                                style={{ borderColor: withAlpha(teamColor, 0.35) }}
                                aria-label={`Delete ${team.name}`}
                                disabled={deletingTeamId === team.id}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="h-4 w-4"
                                >
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {teamRosterCards.length ? (
                          <div className="flex flex-wrap gap-3 justify-center">
                            {teamRosterCards.map((member, index) => {
                              const key = member.memberId?.toString() ?? `${team.id}-${member.name}-${index}`;
                              const isDragging = draggedMemberId === member.memberId;
                              return (
                                <div
                                  key={key}
                                  className={[
                                    "w-full max-w-[220px] sm:w-[calc(50%-0.375rem)]",
                                    isDragging ? "opacity-40" : "",
                                    isDragEnabled && member.memberId
                                      ? "cursor-grab active:cursor-grabbing"
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  draggable={isDragEnabled && Boolean(member.memberId)}
                                  onDragStart={(event) => handleMemberDragStart(event, member)}
                                  onDragEnd={clearDragState}
                                >
                                  <Member
                                    name={member.name}
                                    muted={member.muted ?? false}
                                    audioTrack={member.audioTrack}
                                    videoTrack={member.videoTrack}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-zinc-600 dark:text-zinc-200/80"
                            style={{
                              borderColor: withAlpha(teamColor, 0.35),
                              backgroundColor: withAlpha(teamColor, 0.08),
                            }}
                          >
                            No members in this team yet.
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="flex h-full min-h-0 flex-col gap-4 rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">
              Quizmaster
            </p>
            <div className="mt-3 w-full max-w-xs self-center [&_figcaption]:text-xs [&_figcaption]:tracking-[0.2em]">
              {host ? (
                <Member
                  name={host.name}
                  muted={host.muted ?? false}
                  audioTrack={host.audioTrack}
                  videoTrack={host.videoTrack}
                />
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {hostMissingMessage}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-left text-sm text-emerald-800 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            <p className="font-semibold">{statusTitle}</p>
            <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-100/80">
              {statusBody}
            </p>
            {isHost && onStart ? (
              <div className="mt-3 flex flex-col gap-2">
                {allowReshuffle ? (
                  <button
                    type="button"
                    onClick={handleReshuffle}
                    disabled={isReshuffling}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
                  >
                    Reshuffle
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onStart}
                  disabled={isStartDisabled}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-400 dark:text-zinc-900 dark:hover:bg-emerald-300"
                >
                  Start
                </button>
                {reshuffleError ? (
                  <p className="text-xs text-red-600 dark:text-red-400">{reshuffleError}</p>
                ) : null}
              </div>
            ) : null}
          </div>

        </aside>
      </main>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Create team</h2>
            <form className="mt-4 space-y-4" onSubmit={handleCreateTeam}>
              <div className="space-y-2">
                <label
                  htmlFor="team-name"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                >
                  Team name
                </label>
                <input
                  id="team-name"
                  name="teamName"
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
                  placeholder="Cipher Syndicate"
                  disabled={isSavingTeam}
                  required
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="team-color"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
                >
                  Team color
                </label>
                <ColorPicker
                  color={newTeamColor}
                  onChange={setNewTeamColor}
                  hideInput={["rgb", "hsv", "hex"]}
                  height={140}
                  hideAlpha
                />
              </div>

              {teamError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{teamError}</p>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  disabled={isSavingTeam}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-70 dark:bg-emerald-400 dark:text-zinc-900 dark:hover:bg-emerald-300"
                  disabled={isSavingTeam}
                >
                  {isSavingTeam ? "Saving..." : editingTeamId ? "Save" : "Create team"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {assignTarget ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
                  Assign member
                </p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {assignTarget.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-200 text-zinc-700 transition hover:bg-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <span className="sr-only">Close</span>
                ×
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => void handleAssignTeam(null)}
                disabled={isAssigning}
                className="flex w-full items-center justify-between rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm bg-zinc-400" aria-hidden />
                  Unassigned
                </span>
                <span className="text-xs text-zinc-500">No team</span>
              </button>

              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => void handleAssignTeam(team.id)}
                  disabled={isAssigning}
                  className="flex w-full items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 flex-shrink-0 rounded-sm"
                      style={{ backgroundColor: getColorForTeam(team.id) }}
                      aria-hidden
                      title={team.name}
                    />
                    <span className="break-words text-left leading-snug">{team.name}</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {(rosterByTeamId.get(team.id) ?? []).length} player
                    {(rosterByTeamId.get(team.id) ?? []).length === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>

            {assignError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{assignError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
