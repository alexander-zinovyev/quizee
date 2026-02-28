"use client";

import type { TeamMember } from "@/lib/components/team";
import RoomLobbyLayout from "./room-lobby-layout";
import type { RoomRosterTeam } from "./room-layout-types";

type RoomEndedProps = {
  roomTitle: string;
  roomSlug: string;
  teams: RoomRosterTeam[];
  unassignedMembers: TeamMember[];
  host: TeamMember | null;
  isHost: boolean;
};

export default function RoomEnded({
  roomTitle,
  roomSlug,
  teams,
  unassignedMembers,
  host,
  isHost,
}: RoomEndedProps) {
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
    />
  );
}
