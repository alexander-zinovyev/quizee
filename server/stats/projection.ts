import type { PercentageComponent, StatsGameMetrics, StatsGameWarning, StatsReview, StatsRoundMetrics, StatsSnapshot } from "@/types/stats";
import { calculateOutcomes, calculatePercentage, canonicalPlayerMappings, inferQuestionMaximum, reconcileScore } from "./metrics";
import { completionTime, gameSortValues, normalizeStatsName, sortNumber, STATS_NAMESPACE, type StatsHostContribution, type StatsPlayerContribution } from "./model";

export function projectGame(snapshot: StatsSnapshot, review: StatsReview, version: number) {
  completionTime(review.completedAt);
  for (const [roundId, questions] of Object.entries(review.maxima)) {
    const round = snapshot.rounds.find((round) => round.id === roundId);
    if (!round || Object.keys(questions).some((id) => !round.questions.some((question) => question.id === id))) throw new Error("Maximum override references an unknown question.");
  }
  const canonical = canonicalPlayerMappings(snapshot.appearances, review.mappings);
  const results = calculateOutcomes(snapshot.teams);
  const provisional = snapshot.rounds.some((round) => round.gradingIncomplete === true);
  const warnings: StatsGameWarning[] = [];
  if (provisional) warnings.push({ code: "grading-incomplete" });
  if (snapshot.rounds.some((round) => round.gradingIncomplete === null)) warnings.push({ code: "grading-unavailable" });
  if (review.completedAt === null) warnings.push({ code: "completion-date-unavailable" });
  if (review.packLabel === null) warnings.push({ code: "pack-unavailable" });
  if (!snapshot.rounds.length) warnings.push({ code: "round-detail-unavailable" });
  const finalReconciliations = Object.fromEntries(snapshot.teams.map((team) => [team.id,
    reconcileScore(team.score, snapshot.rounds.map((round) => round.teamScores[team.id] ?? null))]));
  for (const [teamId, result] of Object.entries(finalReconciliations)) if (result.status === "mismatch") warnings.push({ code: "final-score-mismatch", teamId, difference: result.difference! });
  let completeDetail = snapshot.rounds.length > 0;
  const components: PercentageComponent[] = [];
  const rounds = snapshot.rounds.map((round): StatsRoundMetrics => {
    const closestPool = round.scoring.type === "color" ? round.scoring.scoring?.mode === "closest" ? true : round.scoring.scoring === null ? null : false : false;
    // Image manifest questionCount includes image-only distractors; prompt/answer documents define scored questions.
    if (!round.questions.length || (round.scoring.type !== "image" && round.questionCount !== null && round.questionCount !== round.questions.length)) {
      completeDetail = false; warnings.push({ code: "round-detail-unavailable", roundId: round.id });
    }
    const maxima = new Map(round.questions.map((question) => {
      const maximum = inferQuestionMaximum(round.scoring, review.maxima[round.id]?.[question.id]);
      if (maximum.provenance === "default-unverified") warnings.push({ code: "unverified-maximum", roundId: round.id, questionId: question.id });
      return [question.id, maximum];
    }));
    const teams = Object.fromEntries(snapshot.teams.map((team) => {
      const awards = round.questions.map((question) => question.answers[team.id]?.awardedPoints ?? null);
      const reconciliation = reconcileScore(round.teamScores[team.id] ?? null, awards);
      if (reconciliation.status === "mismatch") warnings.push({ code: "round-score-mismatch", roundId: round.id, teamId: team.id, difference: reconciliation.difference! });
      const parts = round.questions.map((question): PercentageComponent => ({
        gameId: snapshot.gameId, roundId: round.id, questionId: question.id, teamId: team.id,
        earned: question.answers[team.id]?.awardedPoints ?? null, maximum: maxima.get(question.id)!, closestPool,
        reconciled: reconciliation.status !== "mismatch", provisional,
      }));
      parts.filter((part) => part.earned !== null && part.earned > part.maximum.points).forEach((part) => warnings.push({ code: "award-exceeds-maximum", roundId: round.id, questionId: part.questionId, teamId: team.id }));
      components.push(...parts.map((part) => ({ ...part, reconciled: part.reconciled && finalReconciliations[team.id].status !== "mismatch" })));
      const recorded = round.questions.map((question) => question.answers[team.id]);
      return [team.id, { score: round.teamScores[team.id] ?? null, percentage: calculatePercentage(parts), reconciliation,
        answers: { recorded: recorded.filter((answer) => answer?.answer !== null && answer !== undefined).length,
          unanswered: recorded.filter((answer) => answer?.answer === "").length,
          knownCorrectness: recorded.filter((answer) => answer?.correctness !== null && answer !== undefined).length,
          incorrect: recorded.filter((answer) => answer?.correctness === false).length, total: round.questions.length } }];
    }));
    return { id: round.id, title: round.title, type: round.scoring.type, closestPool, teams };
  });
  const difficultyParts = completeDetail ? components : components.map((part) => ({ ...part, reconciled: false }));
  const difficulty = calculatePercentage(difficultyParts, "difficulty");
  const comparisons: StatsGameMetrics["comparisons"] = { closestRounds: [], largestSwings: [], highestRoundTeams: [], lowestRoundTeams: [] };
  let spread: number | null = null, swing: number | null = null, high: number | null = null, low: number | null = null;
  rounds.forEach((round) => {
    const known = Object.entries(round.teams).filter(([, result]) => result.score !== null);
    if (known.length >= 2 && known.length === snapshot.teams.length) {
      const scores = known.map(([, result]) => result.score!);
      const current = Math.max(...scores) - Math.min(...scores);
      if (spread === null || current < spread) { spread = current; comparisons.closestRounds = []; }
      if (current === spread) comparisons.closestRounds.push(round.id);
      for (let a = 0; a < known.length; a++) for (let b = a + 1; b < known.length; b++) {
        const change = Math.abs(known[a][1].score! - known[b][1].score!);
        if (swing === null || change > swing) { swing = change; comparisons.largestSwings = []; }
        if (change === swing) comparisons.largestSwings.push({ roundId: round.id, teams: [known[a][0], known[b][0]], change });
      }
    }
    known.forEach(([teamId, result]) => {
      const score = result.score!;
      if (high === null || score > high) { high = score; comparisons.highestRoundTeams = []; }
      if (low === null || score < low) { low = score; comparisons.lowestRoundTeams = []; }
      if (score === high) comparisons.highestRoundTeams.push({ roundId: round.id, teamId, score });
      if (score === low) comparisons.lowestRoundTeams.push({ roundId: round.id, teamId, score });
    });
  });
  const metrics: StatsGameMetrics = { results, rounds, warnings, comparisons, difficulty,
    percentage: calculatePercentage(components, "comparable"), poolPercentage: calculatePercentage(components.filter((part) => part.closestPool === true)) };
  for (const percentage of [metrics.percentage, metrics.poolPercentage, metrics.difficulty]) {
    percentage.coverage.totalGames = 1; percentage.coverage.totalTeams = snapshot.teams.length;
  }
  const roster = canonical.map(({ personId, teamId }) => ({ personId, teamId }));
  const players = new Map<string, StatsPlayerContribution>();
  for (const player of canonical) {
    const result = results.find((team) => team.id === player.teamId);
    if (!result) throw new Error("Mapped player references an unknown team.");
    const own = components.filter((part) => part.teamId === player.teamId);
    const percentage = calculatePercentage(own, "comparable");
    percentage.coverage.totalGames = 1; percentage.coverage.totalTeams = 1;
    const byRoundType = Object.fromEntries([...new Set(rounds.map((round) => round.type))].map((type) => {
      const parts = own.filter((part) => rounds.find((round) => round.id === part.roundId)!.type === type);
      return [type, { percentage: calculatePercentage(parts, "comparable"), poolPercentage: calculatePercentage(parts.filter((part) => part.closestPool === true)) }];
    }));
    players.set(player.personId, { namespace: STATS_NAMESPACE, personId: player.personId, gameId: snapshot.gameId, gameVersion: version,
      completedAt: review.completedAt, outcome: result.outcome, teamPoints: result.score, provisional, teamId: player.teamId,
      aliases: player.aliases, aliasesNormalized: [...new Set(player.aliases.map(normalizeStatsName))], roster, percentage,
      poolPercentage: calculatePercentage(own.filter((part) => part.closestPool === true)), byRoundType,
      sort: { date: sortNumber(completionTime(review.completedAt)), teamPoints: sortNumber(result.score), pointPercentage: sortNumber(percentage.value),
        result: sortNumber(result.outcome === "unavailable" ? null : { win: 3, tie: 2, loss: 1 }[result.outcome]) } });
  }
  let host: StatsHostContribution | null = null;
  if (review.hostPersonId !== null) {
    if (!snapshot.host) throw new Error("A host cannot be mapped without a source host.");
    const teamPercentages = difficulty.value === null ? [] : snapshot.teams.map((team) => calculatePercentage(difficultyParts.filter((part) => part.teamId === team.id), "comparable").value).filter((value): value is number => value !== null);
    const sort = gameSortValues({ completedAt: review.completedAt, packLabel: review.packLabel,
      host: { personId: review.hostPersonId, alias: snapshot.host.alias }, teams: results });
    host = { namespace: STATS_NAMESPACE, personId: review.hostPersonId, gameId: snapshot.gameId, gameVersion: version,
      completedAt: review.completedAt, alias: snapshot.host.alias, aliasesNormalized: snapshot.host.alias === null ? [] : [normalizeStatsName(snapshot.host.alias)],
      difficulty, teamPercentages, uniqueWinningScore: results.find((team) => team.outcome === "win")?.score ?? null, provisional,
      sort: { date: sort.date, pointPercentage: sortNumber(difficulty.value), topScore: sort.topScore, totalScore: sort.totalScore } };
  }
  return { players, host, metrics, summary: {
    sort: gameSortValues({ completedAt: review.completedAt, packLabel: review.packLabel, teams: results,
      host: snapshot.host ? { personId: review.hostPersonId, alias: snapshot.host.alias } : null }), metrics, provisional,
    unresolvedAppearances: snapshot.appearances.filter((appearance) => !review.mappings[appearance.id]?.personId).length,
  } };
}
