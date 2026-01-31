import type { TeamMember } from "@/components/team";

export type RoomRosterTeam = {
  id: string;
  name: string;
  color?: string | null;
  scoreTotal?: number | null;
  members: TeamMember[];
};
