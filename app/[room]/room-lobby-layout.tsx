"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

import Member from "@/components/member";
import type { TeamMember } from "@/components/team";
import { getClientFirestore } from "@/lib/firebase/client";
import type { RoomRosterTeam } from "./room-layout-types";

type RosterCard = {
  id: string;
  name: string;
  badge: string;
  teamName?: string;
  teamId?: string | null;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  muted?: boolean;
};

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

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
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
}: RoomLobbyLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

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

  async function handleAssignTeam(teamId: string | null) {
    if (!allowTeamEditing || !isHost) return;
    if (!assignTarget || isAssigning) return;
    try {
      setIsAssigning(true);
      setAssignError(null);
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug, "members", assignTarget.id), {
        team: teamId,
      });
      setAssignTarget(null);
    } catch (error) {
      console.error("[team-assign]", error);
      setAssignError("Unable to update member right now.");
    } finally {
      setIsAssigning(false);
    }
  }

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    if (!containerRef.current || !contentRef.current) return;

    const containerEl = containerRef.current;
    const contentEl = contentRef.current;

    const computeScale = () => {
      const availableHeight = containerEl.clientHeight;
      const contentHeight = contentEl.scrollHeight;
      if (!availableHeight || !contentHeight) {
        setScale(1);
        return;
      }
      const nextScale = Math.min(1, availableHeight / contentHeight);
      setScale((prev) => (Math.abs(prev - nextScale) > 0.01 ? nextScale : prev));
    };

    const observer = new ResizeObserver(computeScale);
    observer.observe(containerEl);
    observer.observe(contentEl);
    computeScale();

    return () => observer.disconnect();
  }, [rosterCards.length, teams.length, host?.id]);

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
        <section className="flex min-h-0 flex-col rounded-3xl border border-zinc-200 bg-white/80 p-4 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
                Everyone in the lobby
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
              {rosterCards.length}
            </span>
          </div>

          <div ref={containerRef} className="relative mt-3 flex-1 overflow-hidden">
            {rosterCards.length ? (
              <div
                ref={contentRef}
                className="grid h-full w-full gap-3"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  transform: scale < 1 ? `scale(${scale})` : undefined,
                  transformOrigin: "top center",
                }}
              >
                {rosterCards.map((card) => {
                  const color = getColorForTeam(card.teamId);
                  return (
                    <Member
                      key={card.id}
                      name={card.name}
                      muted={card.muted ?? false}
                      audioTrack={card.audioTrack}
                      videoTrack={card.videoTrack}
                      badgeColor={color}
                      badgeTitle={card.teamName ?? "Unassigned"}
                      onBadgeClick={
                        isHost
                          ? () =>
                              setAssignTarget({
                                id: card.id,
                                name: card.name,
                                currentTeamId: card.teamId ?? null,
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-6 py-10 text-center text-sm text-zinc-600 shadow-inner dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                No one is in the lobby yet.
              </div>
            )}
          </div>
        </section>

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
              <button
                type="button"
                onClick={onStart}
                disabled={isStartDisabled}
                className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-400 dark:text-zinc-900 dark:hover:bg-emerald-300"
              >
                Start
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-left text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
                Teams
              </p>
              {isHost && allowTeamEditing ? (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  + Create
                </button>
              ) : null}
            </div>
            {teams.length ? (
              <ul className="mt-2 space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
                {teams.map((team) => (
                  <li
                    key={team.id}
                    className="space-y-1 rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] dark:bg-zinc-900/70"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        className="mt-[2px] inline-block h-3 w-3 flex-shrink-0 rounded-sm"
                        style={{ backgroundColor: getColorForTeam(team.id) }}
                        aria-hidden
                      />
                      <span className="break-words leading-snug">{team.name}</span>
                      {showScores ? (
                        <span className="text-[0.75rem] font-semibold text-emerald-500 dark:text-emerald-300">
                          {team.scoreTotal ?? 0}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.7rem] text-zinc-500">
                        {team.members.length} player{team.members.length === 1 ? "" : "s"}
                      </span>
                      {isHost && allowTeamEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(team)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-200 text-zinc-600 transition hover:bg-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            aria-label={`Edit ${team.name}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-3 w-3"
                            >
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
                              <path d="M14.06 6.19l3.75 3.75" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteTeam(team)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-red-100 text-red-600 transition hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-800/60"
                            aria-label={`Delete ${team.name}`}
                            disabled={deletingTeamId === team.id}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-3 w-3"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                No teams have been created yet.
              </p>
            )}
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
                    {team.members.length} player{team.members.length === 1 ? "" : "s"}
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
