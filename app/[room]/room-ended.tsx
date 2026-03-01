"use client";

import { collection, doc, getDocs, writeBatch } from "firebase/firestore";

import type { TeamMember } from "@/lib/components/team";
import { useRoomRounds } from "@/lib/hooks/use-room-rounds";
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
    const sortedRoundIds = roundsMeta
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((round) => round.id);

    const roundScores = await Promise.all(
      sortedRoundIds.map(async (roundId) => {
        const answersSnap = await getDocs(
          collection(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId, "answers")
        );
        const roundScore = answersSnap.docs.reduce((sum, answerDoc) => {
          const data = answerDoc.data();
          const rawPoints = typeof data.awardedPoints === "number" ? data.awardedPoints : 0;
          return sum + Math.max(0, rawPoints);
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
    badge: string;
    teamName?: string;
    teamId?: string | null;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    muted?: boolean;
  }> = [];

  teams.forEach((team) => {
    team.members.forEach((member) => {
      rosterCards.push({
        id: member.id?.toString() ?? `${team.id}-${member.name}`,
        name: member.name,
        badge: team.name,
        teamName: team.name,
        teamId: team.id,
        audioTrack: member.audioTrack,
        videoTrack: member.videoTrack,
        muted: member.muted,
      });
    });
  });

  unassignedMembers.forEach((member, index) => {
      rosterCards.push({
        id: member.id?.toString() ?? `unassigned-${index}`,
        name: member.name,
        badge: "Unassigned",
        teamName: "Unassigned",
        teamId: null,
        audioTrack: member.audioTrack,
        videoTrack: member.videoTrack,
        muted: member.muted,
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
