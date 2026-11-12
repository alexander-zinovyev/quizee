"use client";

export function QuestionNavigation({ index, count, pending = false, onPrevious, onNext }: {
  index: number; count: number; pending?: boolean; onPrevious: () => void; onNext: () => void;
}) {
  const buttonClass = "rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70";
  return <>
    <button type="button" aria-label="Previous question" title="Previous question" onClick={onPrevious}
      disabled={pending || index <= 0} className={buttonClass}>{"<"}</button>
    <span className="min-w-3 text-center text-zinc-100">{index >= 0 ? index + 1 : 1}</span>
    {index >= 0 ? <button type="button" aria-label={index < count - 1 ? "Next question" : "First question"}
      title={index < count - 1 ? "Next question" : "First question"} onClick={onNext}
      disabled={pending} className={buttonClass}>{index < count - 1 ? ">" : "↺"}</button> : null}
  </>;
}
