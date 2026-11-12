"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  updateDoc,
  type Unsubscribe,
  setDoc,
} from "firebase/firestore";

import Member from "@/lib/components/member";
import Team from "@/lib/components/team";
import { RoundStage } from "@/lib/components/room/round-stage";
import { SortingPresentationControls } from "@/lib/components/room/sorting-presentation-controls";
import { SortingRound } from "@/lib/components/sorting-round";
import { CluesPresenting } from "@/lib/components/clues-presenting";
import { ColorPresenting } from "@/lib/components/color-presenting";
import { PromptNavigation } from "@/lib/components/room/prompt-navigation";
import { QuestionNavigation } from "@/lib/components/room/question-navigation";
import { useCluesNavigation } from "@/lib/hooks/use-clues-navigation";
import { canRetryAutoGrade, getAwardedPoints } from "@/lib/components/room/grading";
import { recordedAnswer } from "@/lib/answers";
import { usePresentingMedia } from "@/lib/hooks/use-presenting-media";
import {
  type RoundQuestion,
  getActiveRounds,
  getSortingQuestions,
  useRoomRounds,
} from "@/lib/hooks/use-room-rounds";
import RoomChatPanel from "./room-chat-panel";
import RoomInteractivePanel from "./room-interactive-panel";
import QuizRound from "@/lib/components/quiz-round";
import RoomHostRoundsPanel from "./room-host-rounds-panel";
import TeamScoreBreakdownDialog from "./team-score-breakdown-dialog";
import { hasActiveForegroundRound, type HostRound } from "./host-rounds";
import { getRoundImageItems, MEDIA_PLACEHOLDER } from "@/lib/media/round-images";
import { getAudioIsolatedRound } from "./round-audio";
import type { RoomRosterTeam } from "./room-layout-types";
import type { TeamMember } from "@/lib/components/team";
import type { SubscriptionPolicy } from "@/lib/media/transport";

import type { QuizRoundData } from "@/types/quiz";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type RoomContentProps = {
  roomSlug: string;
  isHost?: boolean;
  presenting: {
    round?: string | null;
    question?: string | null;
    withAnswer?: boolean;
    promptPage?: number;
    answerPage?: number;
    revealedClueIds?: string[];
  } | null;
  viewerTeamId?: string | null;
  viewerName?: string | null;
  memberNames?: Record<string, string>;
  teams?: RoomRosterTeam[];
  hostMember?: TeamMember | null;
  handRaisingEnabled?: boolean;
  countdownEndsAt?: Date | null;
  onMediaPolicyChange?: (policy: SubscriptionPolicy, options?: { isHost?: boolean }) => void;
};

const DEFAULT_MEDIA_VOLUME = 0.2;

function EyeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path
        d="M2 12c2-3 5.6-6 10-6s8 3 10 6c-2 3-5.6 6-10 6s-8-3-10-6z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function EyeOffIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path
        d="M4.5 4.5C3 6 2 8 2 12c2 3 5.6 6 10 6 2.1 0 4-.5 5.6-1.4M9.88 9.88a3 3 0 104.24 4.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RoomContent({
  roomSlug,
  teams,
  hostMember,
  isHost,
  presenting: hostPresentation,
  viewerTeamId,
  viewerName,
  memberNames,
  handRaisingEnabled = true,
  countdownEndsAt = null,
  onMediaPolicyChange,
}: RoomContentProps) {
  const { user, getToken } = useFirebaseAuth();
  const [teamAnswers, setTeamAnswers] = useState<
    Record<
      string,
      Record<
        string,
        Record<
          string,
          { answer: string; wagered?: boolean; awardedPoints?: number; step?: number | null }
        >
      >
    >
  >({});
  const [isActivatingNext, setIsActivatingNext] = useState(false);
  const [isPresentingUpdatePending, setIsPresentingUpdatePending] = useState(false);
  const [isEndingRound, setIsEndingRound] = useState(false);
  const [isAutoGrading, setIsAutoGrading] = useState(false);
  const [autoGradeFailedRoundId, setAutoGradeFailedRoundId] = useState<string | null>(null);
  const teamAnswerRoundUnsubRef = useRef<Unsubscribe | null>(null);
  const teamAnswerUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const handAudioRef = useRef<HTMLAudioElement | null>(null);
  const handInitRef = useRef(false);
  const handStateRef = useRef<Map<string, boolean>>(new Map());
  const [countdownMinutes, setCountdownMinutes] = useState("1");
  const [countdownSeconds, setCountdownSeconds] = useState("0");
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [localCountdownEndsAt, setLocalCountdownEndsAt] = useState<Date | null>(null);
  const [gradingTeamIndex, setGradingTeamIndex] = useState(0);
  const [activeEavesdropTeamId, setActiveEavesdropTeamId] = useState<string | null>(null);
  const [scoreBreakdownTeamId, setScoreBreakdownTeamId] = useState<string | null>(null);
  const audioIsolatedRoundIdRef = useRef<string | null>(null);

  const {
    gradingRequiredRounds,
    isLoadingRounds,
    roundAnswers,
    roundAnswerHints,
    roundCorrectOrders,
    roundImages,
    roundQuestions,
    roundsError,
    roundsMeta,
    setRoundsError,
  } = useRoomRounds(roomSlug, isHost);

  const browsingRound = !isHost && viewerTeamId ? roundsMeta.find((round) => round.type === "clues" && round.state === "active") : undefined;
  const browsingQuestions = browsingRound ? roundQuestions[browsingRound.id] ?? [] : [];
  const cluesNavigation = useCluesNavigation({ roomSlug, teamId: viewerTeamId, roundId: browsingRound?.id, questions: browsingQuestions });
  const presenting = useMemo(() => browsingRound ? {
    round: browsingRound.id, question: cluesNavigation.questionId, withAnswer: false, promptPage: 0, answerPage: 0,
  } : hostPresentation, [browsingRound, cluesNavigation.questionId, hostPresentation]);
  const browsingQuestionIndex = browsingQuestions.findIndex((question) => question.id === cluesNavigation.questionId);

  const presentingRoundMeta = useMemo(() => {
    if (!presenting?.round) return null;
    return roundsMeta.find((meta) => meta.id === presenting.round) ?? null;
  }, [presenting?.round, roundsMeta]);

  const presentingQuestion = useMemo(() => {
    if (!presenting?.round || !presenting?.question) return null;
    const questions = roundQuestions[presenting.round] ?? [];
    return questions.find((q) => q.id === presenting.question) ?? null;
  }, [presenting?.question, presenting?.round, roundQuestions]);

  const presentingQuestionStageCount = useMemo(() => {
    if (!presentingQuestion) return 0;
    if (presentingQuestion.promptStages?.length) return presentingQuestion.promptStages.length;
    if (presentingQuestion.prompt || presentingQuestion.media) return 1;
    return 0;
  }, [presentingQuestion]);

  const currentPromptPage = useMemo(() => {
    if (!presentingQuestionStageCount) return 0;
    const index = Math.max(0, presenting?.promptPage ?? 0);
    return Math.min(index, presentingQuestionStageCount - 1);
  }, [presenting?.promptPage, presentingQuestionStageCount]);

  const stagedPresentingQuestion = useMemo<RoundQuestion | null>(() => {
    if (!presentingQuestion) return null;
    if (presentingQuestion.promptStages?.length) {
      const stage = presentingQuestion.promptStages[currentPromptPage] ?? null;
      return {
        ...presentingQuestion,
        prompt: stage?.text?.trim().length ? stage.text : null,
        media: stage?.media ?? null,
      };
    }
    return presentingQuestion;
  }, [currentPromptPage, presentingQuestion]);

  const {
    answerMediaError,
    clearCachedMedia,
    getCachedMediaUrl,
    isAnswerMediaLoading,
    isMediaLoading,
    mediaCacheVersion,
    mediaError,
    answerMediaKind,
    mediaKind,
    presentingAnswerMedia,
    presentingAnswerMediaUrl,
    presentingMedia,
    presentingMediaUrl,
    presentingTextAnswer,
    presentingTextAnswerStageCount,
  } = usePresentingMedia({
    presenting,
    presentingQuestion: stagedPresentingQuestion,
    presentingRoundMeta,
    roomSlug,
    roundImages,
    roundQuestions,
    roundsMeta,
    preloadAllImages: Boolean(isHost),
  });

  const rounds: QuizRoundData[] = useMemo(() => {
    // Keeps this memo in sync with media cache invalidations.
    void mediaCacheVersion;
    const mapped = getActiveRounds(roundsMeta)
      .map<QuizRoundData | null>((meta, index) => {
        const questions = roundQuestions[meta.id] ?? [];

        if (meta.type === "sorting") return {
          id: meta.id, type: "sorting", title: meta.title, roundNumber: meta.order + 1,
          state: "active", criterion: meta.criterion!, startingOrder: meta.startingOrder, questions: getSortingQuestions(questions), presenting,
        };

        if (meta.type === "color") return {
          id: meta.id, type: "color", title: meta.title, roundNumber: meta.order + 1,
          questions: questions.map((q) => ({ id: q.id, initialColor: q.initialColor })),
        };

        if (meta.type === "text" || meta.type === "clues") {
          return {
            id: meta.id,
            type: meta.type,
            allowWager: meta.allowWager,
            title: meta.title,
            roundNumber: meta.order + 1 || index + 1,
            questions: questions.map((q) => ({
              ...q,
              prompt:
                q.promptStages?.[0]?.text?.trim() ||
                q.prompt ||
                q.displayPrompt,
              media: null,
            })),
          };
        }

        if (meta.type === "multi-step") {
          if (typeof meta.allowAnswerChanges !== "boolean") throw new Error("Invalid answer-change policy.");
          return {
            id: meta.id,
            type: "multi-step",
            allowAnswerChanges: meta.allowAnswerChanges,
            title: meta.title,
            roundNumber: meta.order + 1 || index + 1,
            questions: questions.map((q) => ({
              ...q,
              prompt:
                q.promptStages?.[0]?.text?.trim() ||
                q.prompt ||
                q.displayPrompt,
              media: null,
            })),
            presenting,
          };
        }

        if (meta.type === "image") {
          const images = getRoundImageItems(roundImages[meta.id] ?? [], getCachedMediaUrl);

          const descriptionQuestions = questions
            .filter((q) => {
              const promptText = q.prompt ?? "";
              return promptText.trim().length > 0 || Boolean(q.media?.storagePath);
            })
            .map((q, qIdx) => ({
              ...q,
              prompt: q.displayPrompt || q.prompt || `Item ${qIdx + 1}`,
              media: q.media?.storagePath
                ? {
                    ...q.media,
                    storagePath: getCachedMediaUrl(q.media.storagePath) ?? MEDIA_PLACEHOLDER,
                  }
                : q.media,
            }));

          return {
            id: meta.id,
            type: "image",
            title: meta.title,
            roundNumber: meta.order + 1 || index + 1,
            questions: descriptionQuestions,
            images,
          };
        }

        return null;
      });

    return mapped.filter((round): round is QuizRoundData => Boolean(round));
  }, [getCachedMediaUrl, mediaCacheVersion, presenting, roundImages, roundQuestions, roundsMeta]);

  const audioIsolatedRoundMeta = useMemo(() => {
    return getAudioIsolatedRound(roundsMeta);
  }, [roundsMeta]);

  const isTeamAudioIsolated = Boolean(audioIsolatedRoundMeta);

  const displayRoundMeta = useMemo(() => {
    if (presentingRoundMeta) return presentingRoundMeta;
    return roundsMeta.find((meta) => meta.state === "active") ?? null;
  }, [presentingRoundMeta, roundsMeta]);

  const activeRoundForControls = useMemo(() => {
    return presentingRoundMeta ?? roundsMeta.find((meta) => meta.state === "active") ?? null;
  }, [presentingRoundMeta, roundsMeta]);

  const controlQuestions = useMemo(() => {
    if (!activeRoundForControls) return [];
    return roundQuestions[activeRoundForControls.id] ?? [];
  }, [activeRoundForControls, roundQuestions]);

  const hostRounds = useMemo<HostRound[]>(() => {
    void mediaCacheVersion;
    return roundsMeta
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((meta, index) => {
        const questions = roundQuestions[meta.id] ?? [];
        const answersForRound = roundAnswers[meta.id] ?? {};

        return {
          id: meta.id,
          title: meta.title,
          order: meta.order,
          roundNumber: meta.order + 1 || index + 1,
          state: meta.state,
          type: meta.type,
          gradingRequired: meta.gradingRequired,
          criterion: meta.criterion,
          correctOrder: roundCorrectOrders[meta.id],
          questionsLoaded: Object.hasOwn(roundQuestions, meta.id),
          sortingQuestions: meta.type === "sorting" ? getSortingQuestions(questions) : undefined,
          images: meta.type === "image" ? getRoundImageItems(roundImages[meta.id] ?? [], getCachedMediaUrl) : undefined,
          questions: questions.map((q, qIndex) => {
            const answer = answersForRound[q.id] ?? q.correctAnswer ?? "";
            return {
              id: q.id,
              prompt: q.prompt ?? q.displayPrompt,
              answer,
              order: q.order ?? qIndex,
            };
          }),
        };
      });
  }, [getCachedMediaUrl, mediaCacheVersion, roundAnswers, roundCorrectOrders, roundImages, roundQuestions, roundsMeta]);

  const presentingAnswer = useMemo(() => {
    if (!presenting?.round || !presenting?.question || !presenting?.withAnswer) return null;
    if (presentingRoundMeta?.type === "text" || presentingRoundMeta?.type === "clues" || presentingRoundMeta?.type === "multi-step") {
      return presentingTextAnswer?.trim().length ? presentingTextAnswer : null;
    }
    const answerFromCollection =
      roundAnswers[presenting.round]?.[presenting.question] ?? null;
    const fallbackAnswer = presentingQuestion?.correctAnswer ?? null;
    const resolved = answerFromCollection ?? fallbackAnswer;
    return resolved?.trim().length ? resolved : null;
  }, [
    presenting?.question,
    presenting?.round,
    presenting?.withAnswer,
    presentingRoundMeta?.type,
    presentingQuestion,
    presentingTextAnswer,
    roundAnswers,
  ]);

  const gradingMatrix = useMemo(() => {
    if (
      !isHost ||
      !presentingRoundMeta ||
      presentingRoundMeta.type === "image" ||
      presentingRoundMeta.type === "color" ||
      presentingRoundMeta.type === "sorting" ||
      presentingRoundMeta.state !== "closed" ||
      presenting?.question ||
      gradingRequiredRounds[presentingRoundMeta.id] === false
    ) {
      return [];
    }
    const roundEntry = teamAnswers[presentingRoundMeta.id] ?? {};
    const questions = roundQuestions[presentingRoundMeta.id] ?? [];

    return (
      teams?.map((team) => {
        const answers = questions.map((q, idx) => {
          const teamAnswer = roundEntry[team.id]?.[q.id as string];
          const hint = (roundAnswerHints[presentingRoundMeta.id] ?? {})[q.id as string] ?? "";
          return {
            questionId: q.id as string,
            order: idx,
            answer: teamAnswer?.answer ?? "",
            hint,
            awardedPoints: teamAnswer?.awardedPoints,
            step: teamAnswer?.step,
            wagered: teamAnswer?.wagered,
          };
        });
        return {
          teamId: team.id,
          teamName: team.name,
          answers,
        };
      }) ?? []
    );
  }, [
    gradingRequiredRounds,
    isHost,
    presenting?.question,
    presentingRoundMeta,
    roundAnswerHints,
    roundQuestions,
    teamAnswers,
    teams,
  ]);

  useEffect(() => {
    setGradingTeamIndex(0);
  }, [presentingRoundMeta?.id, gradingMatrix.length]);

  useEffect(() => {
    if (!isHost) return;
    const currentIsolatedRoundId = audioIsolatedRoundMeta?.id ?? null;
    if (audioIsolatedRoundIdRef.current !== currentIsolatedRoundId) {
      audioIsolatedRoundIdRef.current = currentIsolatedRoundId;
      setActiveEavesdropTeamId(null);
    }
    if (!currentIsolatedRoundId) {
      setActiveEavesdropTeamId(null);
    }
  }, [audioIsolatedRoundMeta?.id, isHost]);

  useEffect(() => {
    if (!onMediaPolicyChange) return;
    if (!isHost) {
      const audioPolicy: SubscriptionPolicy = isTeamAudioIsolated
        ? { audio: "team-only", video: "all" }
        : { audio: "all", video: "all" };
      onMediaPolicyChange(audioPolicy, { isHost: false });
      return;
    }
    onMediaPolicyChange({ audio: "all", video: "all" }, { isHost: true });
  }, [isTeamAudioIsolated, isHost, onMediaPolicyChange]);

  const currentQuestionIndex = useMemo(() => {
    if (!activeRoundForControls || !presentingQuestion) return -1;
    if (presenting?.round !== activeRoundForControls.id) return -1;
    return controlQuestions.findIndex((q) => q.id === presentingQuestion.id);
  }, [activeRoundForControls, controlQuestions, presenting?.round, presentingQuestion]);

  const answerPageCount = useMemo(() => {
    if (!presenting?.withAnswer || !presentingRoundMeta) return 0;
    if (presentingRoundMeta.type === "text" || presentingRoundMeta.type === "clues" || presentingRoundMeta.type === "multi-step") {
      return presentingTextAnswerStageCount;
    }
    return presentingAnswerMediaUrl ? 1 : 0;
  }, [
    presenting?.withAnswer,
    presentingAnswerMediaUrl,
    presentingRoundMeta,
    presentingTextAnswerStageCount,
  ]);

  const currentAnswerPage = useMemo(() => {
    if (!answerPageCount) return 0;
    const index = Math.max(0, presenting?.answerPage ?? 0);
    return Math.min(index, answerPageCount - 1);
  }, [answerPageCount, presenting?.answerPage]);

  async function persistPresentation(next: {
    round: string | null;
    question: string | null;
    withAnswer: boolean;
    promptPage?: number;
    answerPage?: number;
    revealedClueIds?: string[];
  }, options: { activateRound?: string; closeRound?: string } = {}) {
    const token = await getToken();
    const nextPresentation = { ...next, promptPage: next.promptPage ?? 0, answerPage: next.answerPage ?? 0 };
    if (roundsMeta.find((round) => round.id === next.round)?.type === "clues") {
      nextPresentation.revealedClueIds = next.revealedClueIds ??
        (next.round === presenting?.round && next.question === presenting?.question ? presenting?.revealedClueIds ?? [] : []);
    } else {
      delete nextPresentation.revealedClueIds;
    }
    const response = await fetch(`/api/rooms/${roomSlug}/presenting`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        expected: {
          round: presenting?.round ?? null, question: presenting?.question ?? null,
          withAnswer: presenting?.withAnswer ?? false, promptPage: presenting?.promptPage ?? 0,
          answerPage: presenting?.answerPage ?? 0,
          ...(presenting?.revealedClueIds === undefined ? {} : { revealedClueIds: presenting.revealedClueIds }),
        },
        next: nextPresentation,
        ...options,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message ?? "Unable to update presentation.");
    }
  }

  async function updatePresenting(next: {
    round: string | null;
    question: string | null;
    withAnswer: boolean;
    promptPage?: number;
    answerPage?: number;
    revealedClueIds?: string[];
  }) {
    if (!isHost) return;
    setIsPresentingUpdatePending(true);
    try {
      await persistPresentation(next);
    } catch (error) {
      console.error("[room-content] update presenting failed", error);
      setRoundsError("Unable to update current question right now.");
    } finally {
      setIsPresentingUpdatePending(false);
    }
  }

  const presentQuestionFromPanel = async (roundId: string, questionId: string) => {
    await updatePresenting({
      round: roundId,
      question: questionId,
      withAnswer: false,
      promptPage: 0,
      answerPage: 0,
    });
  };

  const hideQuestionFromPanel = async () => {
    await updatePresenting({
      round: presentingRoundMeta?.type === "sorting" ? null : activeRoundForControls?.id ?? null,
      question: null,
      withAnswer: false,
      promptPage: 0,
      answerPage: 0,
    });
  };

  async function gradeRoundFromPanel(roundId: string) {
    if (!isHost) return;
    const round = roundsMeta.find((entry) => entry.id === roundId);
    if (!round || round.state !== "closed" || round.gradingRequired === false) {
      setRoundsError("Only closed rounds awaiting grading can be graded.");
      return;
    }
    if (round.type === "text" || round.type === "clues" || round.type === "multi-step") {
      await updatePresenting({ round: roundId, question: null, withAnswer: false, promptPage: 0, answerPage: 0 });
    } else {
      await autoGradeRound(roundId);
    }
  }

  async function revealRoundFromPanel(roundId: string, withAnswer: boolean) {
    const round = roundsMeta.find((entry) => entry.id === roundId);
    if (!round || round.state !== "closed" || round.gradingRequired !== false) {
      setRoundsError("Finish grading the round before revealing answers.");
      return;
    }
    const question = round.type === "sorting" ? null
      : presenting?.round === roundId && presenting.question ? presenting.question : roundQuestions[roundId]?.[0]?.id ?? null;
    if (round.type !== "sorting" && !question) {
      setRoundsError("Round questions are not available.");
      return;
    }
    await updatePresenting({ round: roundId, question, withAnswer, promptPage: 0, answerPage: 0 });
  }

  async function handleShowFirstQuestion() {
    if (!isHost || !activeRoundForControls) return;
    const firstQuestion = controlQuestions[0];
    if (!firstQuestion) return;
    await updatePresenting({
      round: activeRoundForControls.id,
      question: firstQuestion.id,
      withAnswer: false,
      promptPage: 0,
      answerPage: 0,
    });
  }

  async function handleHideQuestion() {
    if (!isHost || !activeRoundForControls) return;
    await updatePresenting({
      round: activeRoundForControls.id,
      question: null,
      withAnswer: false,
      promptPage: 0,
      answerPage: 0,
    });
  }

  function currentPresentation() {
    return { round: presenting?.round ?? null, question: presenting?.question ?? null,
      withAnswer: presenting?.withAnswer ?? false, promptPage: presenting?.promptPage ?? 0,
      answerPage: presenting?.answerPage ?? 0,
      ...(presenting?.revealedClueIds === undefined ? {} : { revealedClueIds: presenting.revealedClueIds }) };
  }

  async function activateRound(roundId: string) {
    const meta = roundsMeta.find((round) => round.id === roundId);
    if (!meta) throw new Error("Round not found.");
    const next = meta.type === "sorting" ? currentPresentation() : { round: roundId, question: null, withAnswer: false };
    await persistPresentation(next, { activateRound: roundId });
  }

  async function handleActivateSpecificRound(roundId: string) {
    if (!isHost || isActivatingNext) return;
    setIsActivatingNext(true);
    setRoundsError(null);
    try {
      await activateRound(roundId);
    } catch (error) {
      console.error("[room-content] activate round failed", error);
      setRoundsError("Unable to activate that round right now.");
    } finally {
      setIsActivatingNext(false);
    }
  }

  async function handleEndSpecificRound(roundId: string) {
    if (!isHost || isEndingRound) return;
    setIsEndingRound(true);
    setRoundsError(null);
    try {
      const meta = roundsMeta.find((round) => round.id === roundId);
      if (!meta) throw new Error("Round not found.");
      const next = presenting?.round === roundId
        ? { round: roundId, question: null, withAnswer: false }
        : currentPresentation();
      await persistPresentation(next, { closeRound: roundId });
      if (meta.type === "image" || meta.type === "color" || meta.type === "sorting") await autoGradeRound(roundId);
    } catch (error) {
      console.error("[room-content] end round failed", error);
      setRoundsError("Unable to end that round right now.");
    } finally {
      setIsEndingRound(false);
    }
  }

  async function handleToggleAnswer() {
    if (!isHost || !presentingQuestion || !presentingRoundMeta) return;
    await updatePresenting({
      round: presentingRoundMeta.id,
      question: presentingQuestion.id,
      withAnswer: !presenting?.withAnswer,
      promptPage: currentPromptPage,
      answerPage: 0,
    });
  }

  async function handlePrevQuestion() {
    if (!isHost || !activeRoundForControls || currentQuestionIndex <= 0) return;
    const prevQuestion = controlQuestions[currentQuestionIndex - 1];
    if (!prevQuestion) return;
    await updatePresenting({
      round: activeRoundForControls.id,
      question: prevQuestion.id,
      withAnswer: false,
      promptPage: 0,
      answerPage: 0,
    });
  }

  async function handleNextQuestion() {
    if (!isHost || !activeRoundForControls || currentQuestionIndex < 0) return;
    const isLast = currentQuestionIndex >= controlQuestions.length - 1;
    const nextQuestion = isLast ? controlQuestions[0] : controlQuestions[currentQuestionIndex + 1];
    if (!nextQuestion) return;
    await updatePresenting({
      round: activeRoundForControls.id,
      question: nextQuestion.id,
      withAnswer: false,
      promptPage: 0,
      answerPage: 0,
    });
  }

  async function handlePrevPromptPage() {
    if (!isHost || !presentingQuestion || presentingRoundMeta?.type === "multi-step" || currentPromptPage <= 0) return;
    await updatePresenting({
      round: presentingRoundMeta?.id ?? activeRoundForControls?.id ?? null,
      question: presentingQuestion.id,
      withAnswer: Boolean(presenting?.withAnswer),
      promptPage: currentPromptPage - 1,
      answerPage: currentAnswerPage,
    });
  }

  async function handleNextPromptPage() {
    if (!isHost || !presentingQuestion || presentingRoundMeta?.type === "multi-step" || presentingQuestionStageCount <= 0) return;
    const isLast = currentPromptPage >= presentingQuestionStageCount - 1;
    await updatePresenting({
      round: presentingRoundMeta?.id ?? activeRoundForControls?.id ?? null,
      question: presentingQuestion.id,
      withAnswer: Boolean(presenting?.withAnswer),
      promptPage: isLast ? 0 : currentPromptPage + 1,
      answerPage: currentAnswerPage,
    });
  }

  async function handleNextStep() {
    if (!isHost || !presentingQuestion || presentingRoundMeta?.type !== "multi-step" ||
      currentPromptPage >= presentingQuestionStageCount - 1) return;
    await updatePresenting({
      round: presentingRoundMeta.id,
      question: presentingQuestion.id,
      withAnswer: Boolean(presenting?.withAnswer),
      promptPage: currentPromptPage + 1,
      answerPage: currentAnswerPage,
    });
  }

  async function handlePrevAnswerPage() {
    if (!isHost || !presentingQuestion || !presenting?.withAnswer || currentAnswerPage <= 0) {
      return;
    }
    await updatePresenting({
      round: presentingRoundMeta?.id ?? activeRoundForControls?.id ?? null,
      question: presentingQuestion.id,
      withAnswer: true,
      promptPage: currentPromptPage,
      answerPage: currentAnswerPage - 1,
    });
  }

  async function handleNextAnswerPage() {
    if (!isHost || !presentingQuestion || !presenting?.withAnswer || answerPageCount <= 0) return;
    const isLast = currentAnswerPage >= answerPageCount - 1;
    await updatePresenting({
      round: presentingRoundMeta?.id ?? activeRoundForControls?.id ?? null,
      question: presentingQuestion.id,
      withAnswer: true,
      promptPage: currentPromptPage,
      answerPage: isLast ? 0 : currentAnswerPage + 1,
    });
  }

  const setHandRaised = useCallback(
    async (memberId: string, raised: boolean) => {
      if (!roomSlug) return;
      if (!user?.uid) return;
      if (!isHost && memberId !== user.uid) return;
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug, "members", memberId), {
        handRaised: raised,
        handRaisedAt: raised ? serverTimestamp() : null,
      });
    },
    [isHost, roomSlug, user?.uid]
  );

  const lowerHand = useCallback(async (memberId: string) => {
    await setHandRaised(memberId, false);
  }, [setHandRaised]);

  async function toggleOwnHand() {
    if (!user?.uid) return;
    const currentRaised =
      teams
        ?.flatMap((team) => team.members)
        .find((member) => member.id?.toString() === user.uid)
        ?.handRaised ?? false;
    await setHandRaised(user.uid, !currentRaised);
  }

  async function toggleHandRaisingEnabled() {
    if (!isHost) return;
    const db = getClientFirestore();
    await updateDoc(doc(db, "rooms", roomSlug), {
      handRaisingEnabled: !handRaisingEnabled,
    });
  }

  function parseDurationMs() {
    const minutes = Math.max(0, Math.min(99, Number.parseInt(countdownMinutes, 10) || 0));
    const seconds = Math.max(0, Math.min(59, Number.parseInt(countdownSeconds, 10) || 0));
    return (minutes * 60 + seconds) * 1000;
  }

  async function startCountdown() {
    if (!isHost) return;
    const durationMs = parseDurationMs();
    if (durationMs <= 0) return;
    const nextEnd = new Date(Date.now() + durationMs);
    setLocalCountdownEndsAt(nextEnd);
    const db = getClientFirestore();
    await updateDoc(doc(db, "rooms", roomSlug), {
      countdownEndsAt: Timestamp.fromMillis(nextEnd.getTime()),
    });
  }

  async function stopCountdown() {
    if (!isHost) return;
    setLocalCountdownEndsAt(new Date(0));
    const db = getClientFirestore();
    await updateDoc(doc(db, "rooms", roomSlug), {
      countdownEndsAt: null,
    });
  }

  async function autoGradeRound(roundId: string) {
    if (!isHost) return;
    setIsAutoGrading(true);
    setAutoGradeFailedRoundId(null);
    setRoundsError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/rooms/${roomSlug}/rounds/${roundId}/grade`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.error("[room-content] auto-grade failed", payload);
        setRoundsError(payload.message ?? "Unable to auto-grade this round right now.");
        setAutoGradeFailedRoundId(roundId);
      }
    } catch (error) {
      console.error("[room-content] auto-grade failed", error);
      setRoundsError("Unable to auto-grade this round right now.");
      setAutoGradeFailedRoundId(roundId);
    } finally {
      setIsAutoGrading(false);
    }
  }

  async function handleEndRound() {
    if (!activeRoundForControls || activeRoundForControls.state !== "active") return;
    await handleEndSpecificRound(activeRoundForControls.id);
  }

  async function handleEndGame() {
    if (!isHost || !allRoundsClosed) return;
    try {
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug), {
        state: "ended",
        presenting: { round: null, question: null, withAnswer: false, promptPage: 0, answerPage: 0 },
      });
      clearCachedMedia();
    } catch (error) {
      console.error("[room-content] end game failed", error);
      setRoundsError("Unable to end the game right now.");
    }
  }

  async function gradeAnswer(teamId: string, questionId: string, awardedPoints: number) {
    if (!isHost || !presentingRoundMeta || presentingRoundMeta.state !== "closed") return;
    const normalizedPoints = getAwardedPoints(awardedPoints, presentingRoundMeta);
    setTeamAnswers((prev) => {
      const roundId = presentingRoundMeta.id;
      const roundEntry = prev[roundId] ?? {};
      const teamEntry = roundEntry[teamId] ?? {};
      const existingAnswer = teamEntry[questionId] ?? { answer: "" };
      return {
        ...prev,
        [roundId]: {
          ...roundEntry,
          [teamId]: {
            ...teamEntry,
            [questionId]: {
              ...existingAnswer,
              awardedPoints: normalizedPoints,
            },
          },
        },
      };
    });
    const db = getClientFirestore();
    const answerRef = doc(
      db,
      "rooms",
      roomSlug,
      "rounds",
      presentingRoundMeta.id,
      "teamAnswers",
      teamId,
      "answers",
      questionId
    );
    await setDoc(
      answerRef,
      {
        awardedPoints: normalizedPoints,
        gradedAt: serverTimestamp(),
        gradedBy: user?.uid ?? null,
      },
      { merge: true }
    );
  }

  async function recomputeTeamScores(teamId: string) {
    if (!teamId) return;
    const db = getClientFirestore();
    const batch = writeBatch(db);
    const sortedRounds = roundsMeta
      .slice()
      .sort((a, b) => a.order - b.order);

    const roundScores = await Promise.all(
      sortedRounds.map(async (round) => {
        const roundId = round.id;
        if (round.type === "sorting") {
          const frozen = await getDoc(doc(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId));
          return { roundId, roundScore: getAwardedPoints(frozen.data()?.awardedPoints ?? 0, round) };
        }
        const answersSnap = await getDocs(
          collection(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId, "answers")
        );
        const roundScore = answersSnap.docs.reduce((sum, answerDoc) => {
          const data = answerDoc.data();
          const rawPoints = typeof data.awardedPoints === "number" ? data.awardedPoints : 0;
          return sum + getAwardedPoints(rawPoints, round);
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

  async function finalizeScores() {
    if (!isHost || !presentingRoundMeta || presentingRoundMeta.state !== "closed") return;
    const roundId = presentingRoundMeta.id;
    const answersForRound = teamAnswers[roundId] ?? {};
    const db = getClientFirestore();
    const batch = writeBatch(db);

    const teamUpdates = await Promise.all(
      Object.entries(answersForRound).map(async ([teamId, answers]) => {
        const awardedScore = Object.values(answers).reduce((sum, ans) => {
          const points = typeof ans.awardedPoints === "number" ? ans.awardedPoints : 0;
          return sum + getAwardedPoints(points, presentingRoundMeta);
        }, 0);
        const scoreRef = doc(db, "rooms", roomSlug, "teams", teamId, "scores", roundId);
        const teamRef = doc(db, "rooms", roomSlug, "teams", teamId);
        const [scoreSnap, teamSnap] = await Promise.all([
          getDoc(scoreRef),
          getDoc(teamRef),
        ]);
        const previousScore =
          scoreSnap.exists() && typeof scoreSnap.data().score === "number"
            ? (scoreSnap.data().score as number)
            : 0;
        const currentTotal =
          teamSnap.exists() && typeof teamSnap.data().scoreTotal === "number"
            ? (teamSnap.data().scoreTotal as number)
            : 0;
        const nextTotal = currentTotal - previousScore + awardedScore;

        return { teamId, awardedScore, scoreRef, teamRef, nextTotal };
      })
    );

    teamUpdates.forEach(({ teamId, awardedScore, scoreRef, teamRef, nextTotal }) => {
      batch.set(scoreRef, { score: awardedScore }, { merge: true });
      batch.set(teamRef, { scoreTotal: nextTotal }, { merge: true });
      const teamAnswersRef = doc(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId);
      batch.set(teamAnswersRef, { graded: true }, { merge: true });
      const roundMetaRef = doc(db, "rooms", roomSlug, "rounds", roundId);
      batch.set(roundMetaRef, { gradingRequired: false }, { merge: true });
    });

    await batch.commit();
    setGradingTeamIndex(0);
  }

  const nextScheduledRound = useMemo(() => {
    return (
      roundsMeta
        .filter((meta) => meta.state === "scheduled")
        .sort((a, b) => a.order - b.order)[0] ?? null
    );
  }, [roundsMeta]);

  const teamsForDisplay = useMemo(() => {
    if (!teams) return [];
    const hostId = hostMember?.id?.toString() ?? null;
    return teams.map((team) => {
      const isEavesdropTeam = activeEavesdropTeamId === team.id;
      const members = team.members.map((member) => {
        const memberId = member.id?.toString() ?? "";
        const isHostMember = hostId && memberId === hostId;
        let playbackControlsDisabled = false;
        let forcePlaybackMuted = false;
        let onHandClick: (() => void) | undefined;

        if (isTeamAudioIsolated) {
          if (isHost) {
            const allowAudio = isEavesdropTeam;
            playbackControlsDisabled = !allowAudio;
            forcePlaybackMuted = !allowAudio;
          } else if (!isHostMember) {
            const isViewerTeam = viewerTeamId && team.id === viewerTeamId;
            playbackControlsDisabled = !isViewerTeam;
            forcePlaybackMuted = !isViewerTeam;
          }
        }

        if (member.handRaised) {
          const canLower = isHost || memberId === (user?.uid ?? "");
          if (canLower) {
            onHandClick = () => void lowerHand(memberId);
          }
        }

        return {
          ...member,
          playbackControlsDisabled,
          forcePlaybackMuted,
          onHandClick,
        };
      });

      return {
        ...team,
        members,
      };
    });
  }, [
    activeEavesdropTeamId,
    hostMember?.id,
    isTeamAudioIsolated,
    isHost,
    lowerHand,
    teams,
    user?.uid,
    viewerTeamId,
  ]);

  const allRoundsClosed = useMemo(() => {
    if (!roundsMeta.length) return false;
    return roundsMeta.every((meta) => meta.state === "closed");
  }, [roundsMeta]);

  const viewerHandRaised = useMemo(() => {
    if (!user?.uid) return false;
    const member =
      teams
        ?.flatMap((team) => team.members)
        .find((item) => item.id?.toString() === user.uid) ?? null;
    return Boolean(member?.handRaised);
  }, [teams, user?.uid]);

  const effectiveCountdownEndsAt = localCountdownEndsAt ?? countdownEndsAt;
  const countdownTargetMs = effectiveCountdownEndsAt
    ? effectiveCountdownEndsAt.getTime()
    : null;
  const countdownRemainingMs = countdownTargetMs
    ? countdownTargetMs - countdownNow
    : null;
  const countdownIsActive = countdownRemainingMs !== null && countdownRemainingMs > 0;
  const countdownIsUrgent =
    countdownRemainingMs !== null && countdownRemainingMs <= 10_000 && countdownRemainingMs > 0;
  const countdownDisplay = useMemo(() => {
    if (!countdownIsActive || countdownRemainingMs == null) return null;
    const totalSeconds = Math.ceil(countdownRemainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds.toString().padStart(2, "0");
    return `${minutes}:${paddedSeconds}`;
  }, [countdownIsActive, countdownRemainingMs]);

  useEffect(() => {
    if (!countdownTargetMs) return;
    const interval = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 500);
    return () => window.clearInterval(interval);
  }, [countdownTargetMs]);

  useEffect(() => {
    if (!localCountdownEndsAt) return;
    if (!countdownEndsAt) {
      setLocalCountdownEndsAt(null);
      return;
    }
    if (Math.abs(countdownEndsAt.getTime() - localCountdownEndsAt.getTime()) < 500) {
      setLocalCountdownEndsAt(null);
    }
  }, [countdownEndsAt, localCountdownEndsAt]);

  const handMembers = useMemo(() => {
    const members: Array<{ id: string; handRaised: boolean }> = [];
    teams?.forEach((team) => {
      team.members.forEach((member) => {
        const id = member.id?.toString() ?? "";
        if (!id) return;
        members.push({ id, handRaised: Boolean(member.handRaised) });
      });
    });
    if (hostMember?.id) {
      members.push({
        id: hostMember.id.toString(),
        handRaised: Boolean(hostMember.handRaised),
      });
    }
    return members;
  }, [teams, hostMember?.handRaised, hostMember?.id]);

  useEffect(() => {
    if (!handMembers.length) return;
    const previous = handStateRef.current;
    let shouldPlay = false;

    handMembers.forEach((member) => {
      const prevRaised = previous.get(member.id) ?? false;
      if (!handInitRef.current) {
        previous.set(member.id, member.handRaised);
        return;
      }
      if (!prevRaised && member.handRaised) {
        shouldPlay = true;
      }
      previous.set(member.id, member.handRaised);
    });

    if (!handInitRef.current) {
      handInitRef.current = true;
      return;
    }

    if (shouldPlay) {
      if (!handAudioRef.current) {
      handAudioRef.current = new Audio("/hand.mp3");
      }
      handAudioRef.current.currentTime = 0;
      handAudioRef.current.play().catch(() => {
        // ignore browser media-playback restrictions
      });
    }
  }, [handMembers]);

  useEffect(() => {
    if (!isHost || !presentingRoundMeta?.id || presentingRoundMeta.state !== "closed" || presentingRoundMeta.type === "sorting") {
      // Clean up team answer listeners when not grading.
      teamAnswerRoundUnsubRef.current?.();
      teamAnswerRoundUnsubRef.current = null;
      teamAnswerUnsubsRef.current.forEach((unsub) => unsub());
      teamAnswerUnsubsRef.current.clear();
      setTeamAnswers((prev) => {
        if (!presentingRoundMeta?.id) return prev;
        const next = { ...prev };
        delete next[presentingRoundMeta.id];
        return next;
      });
      return;
    }

    const db = getClientFirestore();
    const roundId = presentingRoundMeta.id;
    const teamAnswerUnsubs = teamAnswerUnsubsRef.current;
    const teamAnswersRef = collection(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers");

    const unsubTeams = onSnapshot(teamAnswersRef, (teamsSnapshot) => {
      const currentTeamIds = new Set<string>();

      teamsSnapshot.forEach((teamDoc) => {
        const teamId = teamDoc.id;
        currentTeamIds.add(teamId);
        if (teamAnswerUnsubs.has(teamId)) return;

        const answersRef = collection(teamDoc.ref, "answers");
        const unsubAnswers = onSnapshot(answersRef, (answersSnap) => {
          const answerMap: Record<
            string,
            { answer: string; wagered?: boolean; awardedPoints?: number; step?: number | null }
          > = {};
          answersSnap.forEach((ansDoc) => {
            const data = ansDoc.data();
            answerMap[ansDoc.id] = {
              ...recordedAnswer(data, presentingRoundMeta.type),
              wagered: data.wagered === true,
              awardedPoints:
                typeof data.awardedPoints === "number"
                  ? (data.awardedPoints as number)
                  : undefined,
            };
          });
          setTeamAnswers((prev) => ({
            ...prev,
            [roundId]: {
              ...(prev[roundId] ?? {}),
              [teamId]: {
                ...((prev[roundId] ?? {})[teamId] ?? {}),
                ...answerMap,
              },
            },
          }));
        });

        teamAnswerUnsubs.set(teamId, unsubAnswers);
      });

      // cleanup removed teams
      Array.from(teamAnswerUnsubs.entries()).forEach(([teamId, unsub]) => {
        if (!currentTeamIds.has(teamId)) {
          unsub();
          teamAnswerUnsubs.delete(teamId);
          setTeamAnswers((prev) => {
            const next = { ...prev };
            if (next[roundId]) {
              const roundEntry = { ...next[roundId] };
              delete roundEntry[teamId];
              next[roundId] = roundEntry;
            }
            return next;
          });
        }
      });
    });

    teamAnswerRoundUnsubRef.current = unsubTeams;

    return () => {
      unsubTeams();
      teamAnswerRoundUnsubRef.current = null;
      teamAnswerUnsubs.forEach((unsub) => unsub());
      teamAnswerUnsubs.clear();
    };
  }, [isHost, presentingRoundMeta?.id, presentingRoundMeta?.state, presentingRoundMeta?.type, roomSlug]);

  const resolvedChatName =
    (viewerName && viewerName.trim()) ||
    (isHost ? hostMember?.name?.trim() : undefined) ||
    undefined;

  async function handleActivateNextRound() {
    if (!isHost || !nextScheduledRound || isActivatingNext) return;
    setIsActivatingNext(true);
    setRoundsError(null);

    try {
      await activateRound(nextScheduledRound.id);
    } catch (error) {
      console.error("[room-content] activate next round failed", error);
      setRoundsError("Unable to start the next round right now.");
    } finally {
      setIsActivatingNext(false);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gradient-to-b from-white via-zinc-50 to-zinc-100 dark:from-black dark:via-zinc-950 dark:to-zinc-900">
      <main className="grid h-full grid-rows-2 gap-3 p-1 sm:gap-4 sm:p-2 lg:p-3">
        <section className="grid min-h-0 h-full w-full grid-cols-1 grid-rows-2 items-stretch gap-3 md:grid-cols-2 md:grid-rows-1">
          <article className="presentation-scrollbars flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-950 shadow-2xl dark:border-zinc-800">
            <header className="border-b border-white/10 px-5 py-4 text-white">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                    {displayRoundMeta?.title ?? "Current question"}
                  </p>
                  {countdownDisplay ? (
                    <span
                      className={`text-xs font-semibold uppercase tracking-[0.3em] ${
                        countdownIsUrgent ? "text-red-300" : "text-zinc-400"
                      }`}
                    >
                      {countdownDisplay}
                    </span>
                  ) : null}
                </div>
                <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3 text-right">
                  {presentingQuestion ? (
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100">
                      Question {presentingQuestion.order + 1}
                    </p>
                  ) : null}
                  {isHost && allRoundsClosed ? (
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm text-zinc-300">
                      <span className="min-w-0 break-words">All rounds closed.</span>
                      <button
                        type="button"
                        onClick={handleEndGame}
                        className="shrink-0 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
                      >
                        End game
                      </button>
                    </div>
                  ) : isHost && !hasActiveForegroundRound(roundsMeta) && nextScheduledRound ? (
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm text-zinc-300">
                      <span className="min-w-0 break-words">Next up: {nextScheduledRound.title}</span>
                      <button
                        type="button"
                        onClick={handleActivateNextRound}
                        disabled={isActivatingNext}
                        className="shrink-0 rounded-lg border border-white/30 bg-transparent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isActivatingNext ? "Starting..." : "Next round"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            {browsingRound && cluesNavigation.error ? <p role="alert" className="px-5 pt-3 text-sm text-red-300">{cluesNavigation.error}</p> : null}
            {presentingRoundMeta?.type === "clues" && presentingQuestion ? (
              <CluesPresenting key={`${presentingRoundMeta.id}:${presentingQuestion.id}:${viewerTeamId ?? "host"}`}
                roomSlug={roomSlug} round={presentingRoundMeta} question={presentingQuestion} teamId={viewerTeamId} isHost={!!isHost}
                revealedClueIds={presenting?.revealedClueIds ?? []} pending={isPresentingUpdatePending}
                generalMediaLoading={isMediaLoading} generalMediaError={mediaError} mediaVolume={DEFAULT_MEDIA_VOLUME}
                generalMedia={presentingMedia ? { url: presentingMediaUrl ?? undefined, filename: presentingMedia.filename ?? "" } : undefined}
                answer={presenting?.withAnswer ? { text: presentingAnswer, loading: isAnswerMediaLoading, error: answerMediaError,
                  ...(presentingAnswerMedia ? { media: { url: presentingAnswerMediaUrl ?? undefined, filename: presentingAnswerMedia.filename ?? "" } } : {}) } : undefined}
                onReveal={(revealedClueIds) => void updatePresenting({ ...currentPresentation(), revealedClueIds })} />
            ) : presentingRoundMeta?.type === "sorting" ? (
              <div className="min-h-0 flex-1 overflow-auto text-white">
                <SortingRound key={`${presentingRoundMeta.id}:${presentingRoundMeta.state}`}
                  roomSlug={roomSlug} roundId={presentingRoundMeta.id} criterion={presentingRoundMeta.criterion!} startingOrder={presentingRoundMeta.startingOrder} questions={getSortingQuestions(roundQuestions[presentingRoundMeta.id] ?? [])}
                  state={presentingRoundMeta.state === "closed" ? "closed" : "active"} readOnly
                  reveal={presenting?.withAnswer ?? false} />
              </div>
            ) : presentingRoundMeta?.type === "color" && presentingQuestion ? (
              <ColorPresenting key={`${presentingRoundMeta.id}:${presentingQuestion.id}:${viewerTeamId ?? "host"}`}
                roomSlug={roomSlug} round={presentingRoundMeta} question={presentingQuestion} teamId={viewerTeamId} isHost={!!isHost}
                teams={teams ?? []} withAnswer={presenting?.withAnswer ?? false} />
            ) : <RoundStage
              answerMediaError={answerMediaError}
              displayRoundMeta={displayRoundMeta}
              finalizeScores={() => void finalizeScores()}
              gradeAnswer={(teamId, questionId, awardedPoints) =>
                void gradeAnswer(teamId, questionId, awardedPoints)
              }
              gradingMatrix={gradingMatrix}
              gradingTeamIndex={gradingTeamIndex}
              isAnswerMediaLoading={isAnswerMediaLoading}
              isMediaLoading={isMediaLoading}
              mediaError={mediaError}
              answerMediaKind={answerMediaKind}
              mediaKind={mediaKind}
              mediaVolume={DEFAULT_MEDIA_VOLUME}
              presenting={presenting}
              presentingAnswer={presentingAnswer}
              presentingAnswerMedia={presentingAnswerMedia}
              presentingAnswerMediaUrl={presentingAnswerMediaUrl}
              presentingMedia={presentingMedia}
              presentingMediaUrl={presentingMediaUrl}
              presentingQuestion={stagedPresentingQuestion}
              presentingRoundMeta={presentingRoundMeta}
              setGradingTeamIndex={setGradingTeamIndex}
            />}
            {isHost && activeRoundForControls?.type === "sorting" ? <SortingPresentationControls state={activeRoundForControls.state as "active" | "closed"}
              presented={presenting?.round === activeRoundForControls.id} revealing={presenting?.round === activeRoundForControls.id && presenting.withAnswer === true}
              pending={isPresentingUpdatePending} ending={isEndingRound} retryScoring={canRetryAutoGrade(activeRoundForControls, autoGradeFailedRoundId)}
              onPresent={(withAnswer) => void updatePresenting({ round: activeRoundForControls.id, question: null, withAnswer, promptPage: 0, answerPage: 0 })}
              onHide={() => void updatePresenting({ round: null, question: null, withAnswer: false, promptPage: 0, answerPage: 0 })}
              onEnd={() => void handleEndRound()} onScore={() => void autoGradeRound(activeRoundForControls.id)} /> : null}
            {browsingRound ? <footer className="border-t border-white/10 bg-black/40 px-5 py-3 text-white">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]">
                <span className="text-zinc-300">Question:</span>
                <QuestionNavigation index={browsingQuestionIndex} count={browsingQuestions.length} pending={cluesNavigation.pending}
                  onPrevious={() => { const previous = browsingQuestions[browsingQuestionIndex - 1]; if (previous) void cluesNavigation.selectQuestion(previous.id); }}
                  onNext={() => { const next = browsingQuestions[(browsingQuestionIndex + 1) % browsingQuestions.length]; if (next) void cluesNavigation.selectQuestion(next.id); }} />
              </div>
            </footer> : null}
            {isHost && activeRoundForControls && activeRoundForControls.type !== "sorting" ? (
              <footer className="border-t border-white/10 bg-black/40 px-5 py-3 text-white">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]">
                  <span className="text-zinc-300">Question:</span>
                  {!presentingQuestion && controlQuestions.length ? (
                    <button
                      type="button"
                      onClick={handleShowFirstQuestion}
                      disabled={isPresentingUpdatePending}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <EyeIcon />
                    </button>
                  ) : null}

                  {presentingQuestion ? (
                    <>
                      <button
                        type="button"
                        onClick={handleHideQuestion}
                        disabled={isPresentingUpdatePending}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-500 text-white transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <EyeOffIcon />
                      </button>

                      <QuestionNavigation index={currentQuestionIndex} count={controlQuestions.length} pending={isPresentingUpdatePending}
                        onPrevious={handlePrevQuestion} onNext={handleNextQuestion} />

                      <PromptNavigation
                        type={presentingRoundMeta?.type ?? activeRoundForControls.type}
                        page={currentPromptPage}
                        count={presentingQuestionStageCount}
                        pending={isPresentingUpdatePending}
                        onPrevious={handlePrevPromptPage}
                        onNext={presentingRoundMeta?.type === "multi-step" ? handleNextStep : handleNextPromptPage}
                      />
                    </>
                  ) : null}

                  <div className="ml-auto flex items-center gap-2">
                    {canRetryAutoGrade(activeRoundForControls, autoGradeFailedRoundId) ? (
                      <button type="button" onClick={() => void autoGradeRound(activeRoundForControls.id)} className="rounded bg-emerald-600 px-3 py-2 text-white">Retry scoring</button>
                    ) : null}
                    {activeRoundForControls.state === "active" ? (
                      <button
                        type="button"
                        onClick={handleEndRound}
                        disabled={isEndingRound}
                        className="rounded-lg bg-red-500 px-3 py-2 text-white transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isEndingRound ? "Ending..." : "End round"}
                      </button>
                    ) : null}

                    {activeRoundForControls.state === "closed" && presentingQuestion ? (
                      <>
                        <span className="text-zinc-300">Answer:</span>
                        <button
                          type="button"
                          onClick={handleToggleAnswer}
                          disabled={isPresentingUpdatePending}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-white transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70 ${
                            presenting?.withAnswer
                              ? "bg-red-500 hover:bg-red-400 focus:ring-red-400"
                              : "bg-amber-500 hover:bg-amber-400 focus:ring-amber-400"
                          }`}
                        >
                          {presenting?.withAnswer ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                        {presenting?.withAnswer && answerPageCount > 1 ? (
                          <>
                            <span className="text-zinc-400">Page</span>
                            <button
                              type="button"
                              onClick={handlePrevAnswerPage}
                              disabled={isPresentingUpdatePending || currentAnswerPage <= 0}
                              className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {"<"}
                            </button>
                            <span className="min-w-3 text-center text-zinc-100">
                              {currentAnswerPage + 1}
                            </span>
                            <button
                              type="button"
                              onClick={handleNextAnswerPage}
                              disabled={isPresentingUpdatePending}
                              className="rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {currentAnswerPage < answerPageCount - 1 ? ">" : "↺"}
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </footer>
            ) : null}
          </article>

          <RoomInteractivePanel
            rounds={isHost ? hostRounds : rounds}
            isHost={Boolean(isHost)} keepRoundsMounted={!isHost}
            loading={isLoadingRounds} error={roundsError} onDismissError={() => setRoundsError(null)}
            chat={(active) => <RoomChatPanel active={active} roomSlug={roomSlug} teams={teams} viewerTeamId={viewerTeamId}
              isHost={isHost} viewerName={resolvedChatName} memberNames={memberNames} />}
            renderRound={(roundId) => isHost ? <RoomHostRoundsPanel rounds={hostRounds} selectedRoundId={roundId}
              presenting={presenting} pending={isPresentingUpdatePending || isEndingRound || isActivatingNext || isAutoGrading}
              onPresentQuestion={presentQuestionFromPanel} onHideQuestion={hideQuestionFromPanel}
              onStartRound={handleActivateSpecificRound} onEndRound={handleEndSpecificRound}
              onGradeRound={gradeRoundFromPanel} onRevealRound={revealRoundFromPanel} /> : (() => {
                const round = rounds.find((entry) => entry.id === roundId);
                return round ? <QuizRound {...round} embedded roomSlug={roomSlug} teamId={viewerTeamId ?? undefined} /> : null;
              })()}
          />
        </section>

        <section className="grid min-h-0 h-full grid-cols-5 gap-3">
          {teams?.[0] ? (
            <div className="col-span-2 h-full min-h-0">
              <Team
                name={teams[0].name}
                color={teams[0].color ?? undefined}
                score={
                  teamsForDisplay[0]?.scoreTotal ?? teams[0].scoreTotal ?? undefined
                }
                members={teamsForDisplay[0]?.members ?? teams[0].members}
                appearance="bare"
                className="h-full justify-end"
                emptyLabel="No members yet."
                scoreAction={
                  isHost || viewerTeamId === teams[0].id ? (
                  <button
                    type="button"
                    onClick={() => setScoreBreakdownTeamId(teams[0].id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300/50 bg-zinc-200/70 text-zinc-700 transition hover:bg-zinc-300/80 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    title="Open score breakdown"
                    aria-label={`Open ${teams[0].name} score breakdown`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
                      <path d="M9 8h6" />
                      <path d="M9 12h6" />
                      <path d="M9 16h4" />
                    </svg>
                  </button>
                  ) : null
                }
              />
            </div>
          ) : null}

          <aside className="col-span-1 flex h-full min-h-0 flex-col items-center justify-center gap-4 p-4 rounded-3xl border border-zinc-200 bg-white/90 text-center shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
              QUIZMASTER
            </p>
            <div className="w-full [&_figcaption]:text-xs [&_figcaption]:tracking-[0.2em]">
              {hostMember ? (
                <Member
                  name={hostMember.name}
                  playbackMuted={hostMember.playbackMuted ?? false}
                  audioTrack={hostMember.audioTrack}
                  videoTrack={hostMember.videoTrack}
                  mediaSource={hostMember.mediaSource}
                  localAudioEnabled={hostMember.localAudioEnabled}
                  localVideoEnabled={hostMember.localVideoEnabled}
                  onToggleLocalAudioEnabled={hostMember.onToggleLocalAudioEnabled}
                  onToggleLocalVideoEnabled={hostMember.onToggleLocalVideoEnabled}
                />
              ) : null}
            </div>
            {!isHost ? (
              <button
                type="button"
                onClick={toggleOwnHand}
                disabled={!handRaisingEnabled && !viewerHandRaised}
                className="mt-3 inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {viewerHandRaised ? "Lower hand" : "Raise hand"}
              </button>
            ) : null}
            {isHost ? (
              <div className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 p-2">
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={toggleHandRaisingEnabled}
                    className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    {handRaisingEnabled ? "Disable hand raising" : "Enable hand raising"}
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={countdownMinutes}
                      onChange={(event) => setCountdownMinutes(event.target.value)}
                      className="w-10 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      aria-label="Countdown minutes"
                    />
                    <span className="text-sm text-zinc-500">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={countdownSeconds}
                      onChange={(event) => setCountdownSeconds(event.target.value)}
                      className="w-10 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      aria-label="Countdown seconds"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCountdownMinutes("0");
                        setCountdownSeconds("30");
                      }}
                      className="rounded-lg bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      30s
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCountdownMinutes("1");
                        setCountdownSeconds("0");
                      }}
                      className="rounded-lg bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    >
                      1m
                    </button>
                    <button
                      type="button"
                      onClick={countdownIsActive ? stopCountdown : startCountdown}
                      className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                    >
                      {countdownIsActive ? "Stop" : "Start"}
                    </button>
                  </div>
                  {isTeamAudioIsolated && teams?.length ? (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {teams.map((team) => {
                        const isActive = activeEavesdropTeamId === team.id;
                        return (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() =>
                              setActiveEavesdropTeamId((prev) =>
                                prev === team.id ? null : team.id
                              )
                            }
                            title={
                              isActive
                                ? `Stop listening to ${team.name}`
                                : `Listen to ${team.name}`
                            }
                            className="group inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-700 transition hover:bg-black/20 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={[
                                "h-4 w-4",
                                isActive
                                  ? "text-emerald-500 dark:text-emerald-300"
                                  : "text-zinc-600 dark:text-zinc-300",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <path d="M3 12a9 9 0 0 1 18 0" />
                              <path d="M7 12a5 5 0 0 1 10 0" />
                              <circle cx="12" cy="12" r="1.5" />
                            </svg>
                            {team.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </aside>

          {teams?.[1] ? (
            <div className="col-span-2 h-full min-h-0">
              <Team
                name={teams[1].name}
                color={teams[1].color ?? undefined}
                score={
                  teamsForDisplay[1]?.scoreTotal ?? teams[1].scoreTotal ?? undefined
                }
                members={teamsForDisplay[1]?.members ?? teams[1].members}
                appearance="bare"
                className="h-full justify-end text-right"
                emptyLabel="No members yet."
                scoreAction={
                  isHost || viewerTeamId === teams[1].id ? (
                  <button
                    type="button"
                    onClick={() => setScoreBreakdownTeamId(teams[1].id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300/50 bg-zinc-200/70 text-zinc-700 transition hover:bg-zinc-300/80 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:bg-zinc-700"
                    title="Open score breakdown"
                    aria-label={`Open ${teams[1].name} score breakdown`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
                      <path d="M9 8h6" />
                      <path d="M9 12h6" />
                      <path d="M9 16h4" />
                    </svg>
                  </button>
                  ) : null
                }
              />
            </div>
          ) : null}
        </section>
      </main>
      <TeamScoreBreakdownDialog
        isOpen={Boolean(scoreBreakdownTeamId)}
        onClose={() => setScoreBreakdownTeamId(null)}
        roomSlug={roomSlug}
        teamId={scoreBreakdownTeamId}
        teamName={teams?.find((team) => team.id === scoreBreakdownTeamId)?.name ?? null}
        isHost={isHost}
        roundsMeta={roundsMeta}
        roundQuestions={roundQuestions}
        onPointsUpdated={async (teamId) => {
          await recomputeTeamScores(teamId);
        }}
      />
    </div>
  );
}
