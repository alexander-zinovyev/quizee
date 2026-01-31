"use client";

import type { TeamMember } from "@/components/team";
import RoomLobbyLayout from "./room-lobby-layout";
import type { RoomRosterTeam } from "./room-layout-types";

type RoomPendingProps = {
  roomTitle: string;
  roomSlug: string;
  teams: RoomRosterTeam[];
  unassignedMembers: TeamMember[];
  host: TeamMember | null;
  isHost: boolean;
  onStart?: () => void;
  isStartDisabled?: boolean;
};

export default function RoomPending({
  roomTitle,
  roomSlug,
  teams,
  unassignedMembers,
  host,
  isHost,
  onStart,
  isStartDisabled = false,
}: RoomPendingProps) {
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
    <RoomLobbyLayout
      roomTitle={roomTitle}
      headerKicker="Lobby pending"
      headerDescription="Waiting for the quizmaster to start. Preview teams and lobby members while everyone joins."
      statusTitle="Waiting to start"
      statusBody="Host will begin once teams are finalized. Keep your audio/video ready."
      hostMissingMessage="Host has not joined this room yet."
      host={host}
      teams={teams}
      rosterCards={rosterCards}
      roomSlug={roomSlug}
      isHost={isHost}
      onStart={onStart}
      isStartDisabled={isStartDisabled}
    />
  );
}
