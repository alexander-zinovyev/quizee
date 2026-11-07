import Color from "colorjs.io";
import { hexToHsv } from "@/lib/color";
import { HEX_COLOR, parseColorScoring, type ColorScoring } from "@/types/color";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

export function perceptionScore(answer: string, target: string) {
  if (!HEX_COLOR.test(answer) || !HEX_COLOR.test(target)) throw new Error("Invalid scoring color.");
  // Match Dialed's D65 Lab coordinates. deltaE2000 expects Lab inputs, so pass
  // those coordinates directly rather than adapting them to its default D50.
  const [answerLab, targetLab] = [answer, target].map((hex) => new Color("lab", new Color(hex).to("lab-d65").coords));
  const distance = answerLab.deltaE2000(targetLab);
  const base = 10 / (1 + (distance / 25.25) ** 1.55);
  const answerHsv = hexToHsv(answer), targetHsv = hexToHsv(target);
  const hueDifference = Math.abs(answerHsv.h - targetHsv.h);
  const hueDistance = Math.min(hueDifference, 360 - hueDifference);
  const saturation = (answerHsv.s + targetHsv.s) / 2;
  const hueBonus = (10 - base) * Math.max(0, 1 - (hueDistance / 25) ** 1.5) * Math.min(1, saturation / 30) * 0.25;
  const huePenalty = base * Math.max(0, (hueDistance - 30) / 150) * Math.min(1, saturation / 40) * 0.15;
  const score = Math.max(0, Math.min(10, base + hueBonus - huePenalty));
  return { distance, perceptionScore: Math.round(score * 100) / 100 };
}

export function awardColorPoints(scores: Record<string, number>, scoring: ColorScoring): Record<string, number> {
  const entries = Object.entries(scores);
  if (!entries.every(([, score]) => Number.isFinite(score) && score >= 0 && score <= 10)) throw new Error("Invalid perception score.");
  if (scoring.mode === "proportional") return Object.fromEntries(entries.map(([team, score]) => [team, score / 10]));
  const best = Math.max(...entries.map(([, score]) => score));
  const winners = entries.filter(([, score]) => best - score <= (scoring.mode === "closest" ? scoring.tieTolerance : 0) + 1e-12);
  return Object.fromEntries(entries.map(([team, score]) => [team, scoring.mode === "threshold"
    ? score >= scoring.threshold ? scoring.points : 0
    : winners.some(([winner]) => winner === team) ? scoring.points / winners.length : 0]));
}

export async function gradeColorRound(db: Firestore, roomId: string, roundId: string, uid: string) {
  const room = db.collection("rooms").doc(roomId), round = room.collection("rounds").doc(roundId);
  await db.runTransaction(async (tx) => {
    const member = await tx.get(room.collection("members").doc(uid));
    if (member.data()?.role !== "host") throw new Error("Forbidden");
    const metadata = await tx.get(round);
    if (metadata.data()?.type !== "color" || metadata.data()?.state !== "closed") throw new Error("Color round must be closed before grading.");
    // A transaction makes repeated or concurrent grading requests idempotent.
    if (metadata.data()?.gradingRequired === false) return;
    const scoring = parseColorScoring(metadata.data()?.scoring);
    const questions = await tx.get(round.collection("questions"));
    const targets = await tx.get(round.collection("answers"));
    const teams = await tx.get(room.collection("teams"));
    const inputs = new Map<string, Map<string, string>>();
    const previousScores = new Map<string, number>();
    for (const team of teams.docs) {
      const answers = await tx.get(round.collection("teamAnswers").doc(team.id).collection("answers"));
      inputs.set(team.id, new Map(answers.docs.map((answer) => [answer.id, answer.data().answer])));
      const previous = await tx.get(team.ref.collection("scores").doc(roundId));
      previousScores.set(team.id, previous.data()?.score ?? 0);
    }
    const totals = new Map(teams.docs.map((team) => [team.id, 0]));
    const results: Array<{ team: string; question: string; answer: string; distance: number; perceptionScore: number; awardedPoints: number }> = [];
    for (const question of questions.docs) {
      const target = targets.docs.find((doc) => doc.id === question.id)?.data().answer;
      if (typeof target !== "string") throw new Error("Missing target color.");
      const scores = Object.fromEntries(teams.docs.map((team) => {
        const answer = inputs.get(team.id)?.get(question.id) ?? question.data().initialColor;
        return [team.id, { answer, ...perceptionScore(answer, target) }];
      }));
      const awarded = awardColorPoints(Object.fromEntries(Object.entries(scores).map(([team, result]) => [team, result.perceptionScore])), scoring);
      for (const [team, result] of Object.entries(scores)) {
        totals.set(team, totals.get(team)! + awarded[team]);
        results.push({ team, question: question.id, ...result, awardedPoints: awarded[team] });
      }
    }
    const now = Timestamp.now();
    for (const { team, question, ...result } of results) tx.set(round.collection("teamAnswers").doc(team).collection("answers").doc(question), { ...result, gradedAt: now, gradedBy: uid }, { merge: true });
    for (const team of teams.docs) {
      const score = totals.get(team.id)!;
      tx.set(team.ref.collection("scores").doc(roundId), { score }, { merge: true });
      tx.set(team.ref, { scoreTotal: (team.data().scoreTotal ?? 0) + score - previousScores.get(team.id)! }, { merge: true });
      tx.set(round.collection("teamAnswers").doc(team.id), { graded: true, gradedAt: now }, { merge: true });
    }
    tx.set(round, { gradingRequired: false, gradedAt: now }, { merge: true });
  });
}
