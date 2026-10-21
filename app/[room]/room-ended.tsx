"use client";

import { collection, doc, getDocs, writeBatch } from "firebase/firestore";

import type { TeamMember } from "@/lib/components/team";
import type { MediaRenderSource } from "@/lib/media/transport";
import { useRoomRounds } from "@/lib/hooks/use-room-rounds";
import { getAwardedPoints } from "@/lib/components/room/grading";
import { getClientFirestore } from "@/lib/firebase/client";
import RoomLobbyLayout from "./room-lobby-layout";
import type { RoomRosterTeam } from "./room-layout-types";
import TeamScoreBreakdownDialog from "./team-score-breakdown-dialog";
import { useState } from "react";

type RoomEndedProps = {
  roomTitle: string;
  roomSlug: string;
  teams: RoomRosterTeam[];
  unassignedMembers: TeamMember[];
  host: TeamMember | null;
  isHost: boolean;
  viewerTeamId?: string | null;
};

export default function RoomEnded({
  roomTitle,
  roomSlug,
  teams,
  unassignedMembers,
  host,
  isHost,
  viewerTeamId = null,
}: RoomEndedProps) {
  const [scoreBreakdownTeamId, setScoreBreakdownTeamId] = useState<string | null>(null);
  const { roundsMeta, roundQuestions } = useRoomRounds(roomSlug, isHost);

  async function recomputeTeamScores(teamId: string) {
    if (!teamId) return;
    const db = getClientFirestore();
    const batch = writeBatch(db);
    const sortedRounds = roundsMeta
      .slice()
      .sort((a, b) => a.order - b.order);

    const roundScores = await Promise.all(
      sortedRounds.map(async (round) => {
        const roundId = round.id;
        const answersSnap = await getDocs(
          collection(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId, "answers")
        );
        const roundScore = answersSnap.docs.reduce((sum, answerDoc) => {
          const data = answerDoc.data();
          const rawPoints = typeof data.awardedPoints === "number" ? data.awardedPoints : 0;
          return sum + getAwardedPoints(rawPoints, round);
        }, 0);
        return { roundId, roundScore };
      })
    );

    const scoreTotal = roundScores.reduce((sum, entry) => sum + entry.roundScore, 0);
    roundScores.forEach(({ roundId, roundScore }) => {
      batch.set(
        doc(db, "rooms", roomSlug, "teams", teamId, "scores", roundId),
        { score: roundScore },
        { merge: true }
      );
    });

    batch.set(doc(db, "rooms", roomSlug, "teams", teamId), { scoreTotal }, { merge: true });
    await batch.commit();
  }

  const rosterCards: Array<{
    id: string;
    name: string;
    teamName?: string;
    teamId?: string | null;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    mediaSource?: MediaRenderSource;
    playbackMuted?: boolean;
    localAudioEnabled?: boolean;
    localVideoEnabled?: boolean;
    onToggleLocalAudioEnabled?: () => void;
    onToggleLocalVideoEnabled?: () => void;
  }> = [];

  teams.forEach((team) => {
    team.members.forEach((member) => {
      rosterCards.push({
        id: member.id?.toString() ?? `${team.id}-${member.name}`,
        name: member.name,
        teamName: team.name,
        teamId: team.id,
        audioTrack: member.audioTrack,
        videoTrack: member.videoTrack,
        mediaSource: member.mediaSource,
        playbackMuted: member.playbackMuted,
        localAudioEnabled: member.localAudioEnabled,
        localVideoEnabled: member.localVideoEnabled,
        onToggleLocalAudioEnabled: member.onToggleLocalAudioEnabled,
        onToggleLocalVideoEnabled: member.onToggleLocalVideoEnabled,
      });
    });
  });

  unassignedMembers.forEach((member, index) => {
      rosterCards.push({
        id: member.id?.toString() ?? `unassigned-${index}`,
        name: member.name,
        teamName: "Unassigned",
        teamId: null,
        audioTrack: member.audioTrack,
        videoTrack: member.videoTrack,
        mediaSource: member.mediaSource,
        playbackMuted: member.playbackMuted,
        localAudioEnabled: member.localAudioEnabled,
        localVideoEnabled: member.localVideoEnabled,
        onToggleLocalAudioEnabled: member.onToggleLocalAudioEnabled,
        onToggleLocalVideoEnabled: member.onToggleLocalVideoEnabled,
      });
    });

  return (
    <>
      <RoomLobbyLayout
        roomTitle={roomTitle}
        headerKicker="Quiz ended"
        headerDescription="Final standings and recaps appear here. Teams and players remain visible for debrief."
        statusTitle="Debrief in progress"
        statusBody="Browse results and highlights while everyone wraps up."
        hostMissingMessage="Host is offline."
        host={host}
        teams={teams}
        rosterCards={rosterCards}
        roomSlug={roomSlug}
        isHost={isHost}
        showScores
        allowTeamEditing={false}
        viewerTeamId={viewerTeamId}
        allowScoreActionForAllTeams
        renderTeamScoreAction={(team) => (
          <button
            type="button"
            onClick={() => setScoreBreakdownTeamId(team.id)}
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-zinc-300/50 bg-zinc-200/70 text-zinc-700 transition hover:bg-zinc-300/80 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:bg-zinc-700"
            title="Open score breakdown"
            aria-label={`Open ${team.name} score breakdown`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3"
            >
              <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
              <path d="M9 8h6" />
              <path d="M9 12h6" />
              <path d="M9 16h4" />
            </svg>
          </button>
        )}
      />
      <TeamScoreBreakdownDialog
        isOpen={Boolean(scoreBreakdownTeamId)}
        onClose={() => setScoreBreakdownTeamId(null)}
        roomSlug={roomSlug}
        teamId={scoreBreakdownTeamId}
        teamName={teams.find((team) => team.id === scoreBreakdownTeamId)?.name ?? null}
        isHost={isHost}
        roundsMeta={roundsMeta}
        roundQuestions={roundQuestions}
        onPointsUpdated={async (teamId) => {
          await recomputeTeamScores(teamId);
        }}
      />
    </>
  );
}
