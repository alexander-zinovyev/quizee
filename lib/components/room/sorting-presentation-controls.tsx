"use client";

export function SortingPresentationControls({ state, presented, revealing, pending, ending, retryScoring, onPresent, onHide, onEnd, onScore }: {
  state: "active" | "closed"; presented: boolean; revealing: boolean; pending: boolean; ending: boolean; retryScoring: boolean;
  onPresent: (withAnswer: boolean) => void; onHide: () => void; onEnd: () => void; onScore: () => void;
}) {
  return <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-black/40 px-5 py-3 text-white">
    <button type="button" disabled={pending} onClick={() => presented ? onHide() : onPresent(false)} className="rounded bg-emerald-600 px-3 py-2">{presented ? "Hide round" : "Show round"}</button>
    {state === "closed" ? <button type="button" disabled={pending} onClick={() => onPresent(!revealing)} className="rounded bg-amber-600 px-3 py-2">{revealing ? "Hide answer" : "Show answer"}</button> : null}
    {state === "active" ? <button type="button" onClick={onEnd} disabled={ending} className="rounded bg-red-600 px-3 py-2">End round</button> : null}
    {retryScoring ? <button type="button" onClick={onScore} className="rounded bg-emerald-600 px-3 py-2">Retry scoring</button> : null}
  </footer>;
}
