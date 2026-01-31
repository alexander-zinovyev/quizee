import type { Metadata } from "next";
import TextQuizRound from "@/components/text-round";
import type { TextQuizQuestion } from "@/components/quiz-round";

const demoQuestions: TextQuizQuestion[] = [
  {
    id: "founders",
    type: "text",
    prompt: "Complete the lorem ipsum quote about innovative founders.",
    placeholder: "Lorem ipsum dolor sit amet...",
    points: 1,
  },
  {
    id: "galaxy",
    type: "text",
    prompt: "Name the fictitious galaxy mentioned in our ipsum briefing.",
    placeholder: "Enter galaxy name",
    points: 2,
  },
  {
    id: "artifact",
    type: "text",
    prompt: "What single word describes the hidden artifact in the ipsum lore?",
    placeholder: "mysterious?",
    points: 1,
  },
  {
    id: "protocol",
    type: "text",
    prompt: "The lorem protocol requires which color key phrase?",
    placeholder: "e.g. cerulean cipher",
    points: 3,
  },
  {
    id: "ending",
    type: "text",
    prompt: "Wrap up the ipsum mission log with a closing salutation.",
    placeholder: "Stay curious, ...",
    points: 1,
  },
];

export const metadata: Metadata = {
  title: "Text round demo",
  description: "Showcase of the TextQuizRound component with placeholder prompts.",
};

export default function TextRoundDemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-zinc-50 to-zinc-100 py-16 dark:from-black dark:via-zinc-900 dark:to-zinc-950">
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6">
        <header className="space-y-4 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
            Component demo
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold text-zinc-900 dark:text-white">
              TextQuizRound playground
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Enter dummy answers to the lorem ipsum prompts below. This mirrors the quiz experience,
              showing button states, validation, and answered/disabled behavior without needing
              real backend data.
            </p>
          </div>
        </header>

        <TextQuizRound questions={demoQuestions} />
      </main>
    </div>
  );
}
