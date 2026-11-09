"use client";

import type { CluesQuestion } from "@/types/clues";
import type { MediaTreeFile } from "./media-tree-shared";
import MediaSelector from "./media-selector";

export type BuildCluesQuestion = CluesQuestion & { id: string };
export function createCluesQuestion(): BuildCluesQuestion {
  return { id: crypto.randomUUID(), prompt: "", answer: "", clues: [{ id: crypto.randomUUID(), category: "", price: 1, text: "" }] };
}
export function CluesRoundEditor({ startingCoins, questions, mediaFiles, onChange }: {
  startingCoins: number; questions: BuildCluesQuestion[]; mediaFiles: MediaTreeFile[];
  onChange: (startingCoins: number, questions: BuildCluesQuestion[]) => void;
}) {
  const field = "mt-1 block w-full rounded-md border border-zinc-300 bg-transparent p-2 dark:border-zinc-700";
  function update(next: BuildCluesQuestion) { onChange(startingCoins, questions.map((question) => question.id === next.id ? next : question)); }
  return <div className="space-y-3">
    <label className="block text-sm font-semibold">Starting coins
      <input aria-label="Starting coins" type="number" min={1} step={1} value={startingCoins} className={field}
        onChange={(event) => onChange(event.target.valueAsNumber, questions)} />
    </label>
    <p className="text-sm text-zinc-500">Each team shares this budget across the round. Correct answers earn one point regardless of coins spent.</p>
    {questions.map((question, index) => <section key={question.id} aria-label={`Clues question ${index + 1}`} className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-center justify-between"><p className="font-semibold">Question {index + 1}</p>
        <button type="button" onClick={() => onChange(startingCoins, questions.filter((item) => item.id !== question.id))} className="text-sm text-red-600">Remove question</button>
      </div>
      <label className="block text-sm">Prompt<textarea aria-label="Question prompt" value={question.prompt} className={field} onChange={(event) => update({ ...question, prompt: event.target.value })} /></label>
      <label className="block text-sm">Accepted answer<input aria-label="Accepted answer" value={question.answer} className={field} onChange={(event) => update({ ...question, answer: event.target.value })} /></label>
      {question.clues.map((clue, clueIndex) => {
        const change = (next: typeof clue) => update({ ...question, clues: question.clues.map((item) => item.id === clue.id ? next : item) });
        return <fieldset key={clue.id} className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-700">
          <legend className="px-1 text-sm font-semibold">Clue {clueIndex + 1}</legend>
          <label className="block text-sm">Category<input aria-label="Clue category" value={clue.category} className={field} onChange={(event) => change({ ...clue, category: event.target.value })} /></label>
          <label className="block text-sm">Coin price<input aria-label="Coin price" type="number" min={1} step={1} value={clue.price} className={field} onChange={(event) => change({ ...clue, price: event.target.valueAsNumber })} /></label>
          <label className="block text-sm">Text<textarea aria-label="Clue text" value={clue.text} className={field} onChange={(event) => change({ ...clue, text: event.target.value })} /></label>
          <p className="text-sm">Image (optional)</p>
          <MediaSelector value={clue.image ?? null} mediaFiles={mediaFiles.filter((file) => /\.(png|jpe?g|gif|webp|svg)$/.test(file.path))}
            onChange={(image) => { const next = { ...clue }; if (image) next.image = image; else delete next.image; change(next); }} />
          <button type="button" onClick={() => update({ ...question, clues: question.clues.filter((item) => item.id !== clue.id) })} className="text-sm text-red-600">Remove clue</button>
        </fieldset>;
      })}
      <button type="button" onClick={() => update({ ...question, clues: [...question.clues, { id: crypto.randomUUID(), category: "", price: 1, text: "" }] })} className="rounded border px-3 py-1 text-sm">Add clue</button>
    </section>)}
    <button type="button" onClick={() => onChange(startingCoins, [...questions, createCluesQuestion()])} className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Add clues question</button>
  </div>;
}
