"use client";

export function PromptNavigation({ type, page, count, pending = false, onPrevious, onNext }: {
  type: "text" | "image" | "multi-step";
  page: number;
  count: number;
  pending?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const multiStep = type === "multi-step";
  if (count < 1 || (!multiStep && count === 1)) return null;
  const hasNext = page < count - 1;
  const buttonClass = "rounded-lg bg-zinc-700 px-2 py-2 text-white transition hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70";
  return (
    <div className="ml-4 inline-flex shrink-0 items-center gap-2">
      <span className="text-zinc-400">{multiStep ? "Step" : "Page"}</span>
      {!multiStep ? (
        <button type="button" onClick={onPrevious} disabled={pending || page <= 0} className={buttonClass} title="Previous page">
          {"<"}
        </button>
      ) : null}
      <span className="min-w-3 text-center text-zinc-100">{page + 1}</span>
      {!multiStep || hasNext ? (
        <button type="button" onClick={onNext} disabled={pending} className={buttonClass}
          title={multiStep ? "Next step" : hasNext ? "Next page" : "First page"}>
          {hasNext ? ">" : "\u21ba"}
        </button>
      ) : null}
    </div>
  );
}
