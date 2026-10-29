import type { RoomSource, SourceDocument, SourceRound } from "./source";

/** Maintainer's usual upper range: two teams, six players, nine rounds, ten questions each. */
export function roomSourceFixture(roundCount = 9, questionCount = 10): RoomSource {
  const teams = ["red", "blue"].map((id) => ({ id, data: { name: id, scoreTotal: 0 }, scores: [] as SourceDocument[] }));
  const members: SourceDocument[] = ["red", "blue"].flatMap((team) => Array.from({ length: 3 }, (_, index) => ({
    id: `${team}-uid-${index}`, data: { name: `${team} player ${index}`, role: "player", team },
  })));
  members.push({ id: "host-uid", data: { name: "Host", role: "host", team: null } });
  const rounds: SourceRound[] = Array.from({ length: roundCount }, (_, roundIndex) => {
    const id = `round-${roundIndex + 1}`;
    const type = (["text", "image", "multi-step", "color"] as const)[roundIndex % 4];
    const colorScoring = roundIndex % 8 === 3 ? { mode: "closest", points: 1, tieTolerance: 0.05 }
      : { mode: "threshold", points: 2, threshold: 8.5 };
    const questions: SourceDocument[] = [], answers: SourceDocument[] = [], images: SourceDocument[] = [];
    const teamAnswers: SourceRound["teamAnswers"] = Object.fromEntries(teams.map((team) => [team.id, { metadata: { graded: true }, answers: [] }]));
    const totals: Record<string, number> = { red: 0, blue: 0 };
    for (let index = 0; index < questionCount; index++) {
      const questionId = `question-${index + 1}`;
      const media = { storagePath: `rooms/demo/media/${id}/${questionId}.png`, contentType: "image/png" };
      questions.push({ id: questionId, data: { order: index,
        ...(type === "image" ? { text: `Match ${index}` } : type === "color" ? { media, initialColor: "#123456", mask: media }
          : { stages: [{ text: `Prompt ${index}` }] }) } });
      answers.push({ id: questionId, data: type === "image" ? { answer: `image-${index}` } : type === "color" ? { answer: "#ABCDEF" } : { stages: [{ text: `Answer ${index}` }] } });
      if (type === "image") images.push({ id: `image-${index}`, data: { media } });
      for (const team of teams) {
        const points = type === "multi-step" ? team.id === "red" ? 5 : -2 : type === "color" && colorScoring.mode === "closest" ? 0.5
          : team.id === "red" ? type === "color" ? 2 : 1 : 0;
        totals[team.id] += points;
        const answer = type === "image" ? `image-${index}` : type === "color" ? "#ABCDEF" : "An answer";
        teamAnswers[team.id].answers.push({ id: questionId, data: { awardedPoints: points,
          ...(type === "multi-step" ? { attempts: [{ answer, step: 0, submittedBy: `${team.id}-uid-0`, submittedAt: null }] } : { answer }),
          ...(type === "color" ? { perceptionScore: team.id === "red" ? 10 : 8 } : {}) } });
      }
    }
    teams.forEach((team) => {
      team.scores.push({ id, data: { score: totals[team.id] } });
      team.data.scoreTotal += totals[team.id];
    });
    return { id, data: { title: `Round ${roundIndex + 1}`, order: roundIndex, type, state: "closed", gradingRequired: false, questionCount,
      ...(type === "multi-step" ? { pointsPerStep: [5, 3, -2] } : type === "color" ? { scoring: colorScoring } : {}) }, questions, answers, images, teamAnswers };
  });
  return { room: { id: "demo", data: { title: "Test quiz", state: "ended", createdAt: "2026-01-01T00:00:00.000Z" } },
    readAt: "2026-10-29T12:00:00.000Z", members, teams, rounds };
}
