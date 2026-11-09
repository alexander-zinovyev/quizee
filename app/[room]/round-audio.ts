import type { RoundMeta } from "@/lib/hooks/use-room-rounds";

export function getAudioIsolatedRound(rounds: RoundMeta[]): RoundMeta | null {
  return rounds.find((round) =>
    round.state === "active" &&
    (round.type === "clues" || round.type === "text" || round.type === "multi-step" || round.type === "color")
  ) ?? null;
}
