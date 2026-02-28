import type { TeamMember } from "@/lib/components/team";

export type RoomRosterTeam = {
  id: string;
  name: string;
  color?: string | null;
  scoreTotal?: number | null;
  members: TeamMember[];
};
