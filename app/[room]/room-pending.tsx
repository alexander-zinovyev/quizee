"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import type { TeamMember } from "@/lib/components/team";
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

const FAKE_MEMBER_NAMES = [
  "Alex",
  "Sam",
  "Jordan",
  "Taylor",
  "Riley",
  "Morgan",
  "Casey",
  "Avery",
  "Parker",
  "Reese",
  "Quinn",
  "Jamie",
];

function isFakeMemberId(value: TeamMember["id"] | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("fake-member-");
}

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
  const searchParams = useSearchParams();
  const { fakeMembersCount, fakeTeamMembersCount } = useMemo(() => {
    if (process.env.NODE_ENV !== "development") {
      return {
        fakeMembersCount: 0,
        fakeTeamMembersCount: 0,
      };
    }
    const parseCount = (value: string | null) => {
      if (!value) return 0;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    };
    return {
      fakeMembersCount: parseCount(searchParams.get("fakeMembers")),
      fakeTeamMembersCount: parseCount(searchParams.get("fakeTeamMembers")),
    };
  }, [searchParams]);

  const { displayTeams, displayUnassignedMembers } = useMemo(() => {
    const teamsClone = teams.map((team) => ({
      ...team,
      members: [...team.members],
    }));
    const unassignedClone = [...unassignedMembers];
    const currentTeamMembersCount = teamsClone.reduce((sum, team) => sum + team.members.length, 0);
    const currentUnassignedCount = unassignedClone.length;
    const fakeTeamMembersToAdd = Math.max(0, fakeTeamMembersCount - currentTeamMembersCount);
    const fakeUnassignedToAdd = Math.max(0, fakeMembersCount - currentUnassignedCount);

    for (let index = 0; index < fakeTeamMembersToAdd; index += 1) {
      const fakeMember: TeamMember = {
        id: `fake-team-member-${index + 1}`,
        name: FAKE_MEMBER_NAMES[index % FAKE_MEMBER_NAMES.length] + ` ${index + 1}`,
        muted: true,
      };
      if (teamsClone.length) {
        teamsClone[index % teamsClone.length].members.push(fakeMember);
      }
    }

    for (let index = 0; index < fakeUnassignedToAdd; index += 1) {
      unassignedClone.push({
        id: `fake-member-${index + 1}`,
        name: FAKE_MEMBER_NAMES[index % FAKE_MEMBER_NAMES.length] + ` ${index + 1}`,
        muted: true,
      });
    }

    return {
      displayTeams: teamsClone,
      displayUnassignedMembers: unassignedClone,
    };
  }, [fakeMembersCount, fakeTeamMembersCount, teams, unassignedMembers]);

  const rosterCards: Array<{
    id: string;
    memberId?: string | null;
    name: string;
    teamName?: string;
    teamId?: string | null;
    audioTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    muted?: boolean;
  }> = [];

  displayTeams.forEach((team) => {
    team.members.forEach((member) => {
      const memberId = member.id?.toString() ?? null;
      rosterCards.push({
        id: memberId ?? `${team.id}-${member.name}`,
        memberId: isFakeMemberId(member.id) ? null : memberId,
        name: member.name,
        teamName: team.name,
        teamId: team.id,
        audioTrack: member.audioTrack,
        videoTrack: member.videoTrack,
        muted: member.muted,
      });
    });
  });

  displayUnassignedMembers.forEach((member, index) => {
    const memberId = member.id?.toString() ?? null;
    rosterCards.push({
      id: memberId ?? `unassigned-${index}`,
      memberId: isFakeMemberId(member.id) ? null : memberId,
      name: member.name,
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
      teams={displayTeams}
      rosterCards={rosterCards}
      roomSlug={roomSlug}
      isHost={isHost}
      showScores={false}
      allowReshuffle={true}
      onStart={onStart}
      isStartDisabled={isStartDisabled}
    />
  );
}
