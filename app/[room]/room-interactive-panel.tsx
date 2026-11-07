"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PanelIcon, type PanelIconName } from "@/lib/components/room/panel-icon";

export type InteractiveRound = {
  id: string;
  title: string;
  roundNumber: number;
  type: "text" | "image" | "sorting" | "color" | "multi-step";
  state?: "scheduled" | "active" | "closed";
};

const roundIcons: Record<InteractiveRound["type"], PanelIconName> = {
  text: "text", image: "image", sorting: "sorting", color: "image", "multi-step": "text",
};

function MountedPanelView({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active) return;
    ref.current?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
  }, [active]);
  return <div ref={ref} id={id} hidden={!active} className="h-full min-h-0 min-w-0">{children}</div>;
}

export default function RoomInteractivePanel({ rounds, chat, renderRound, isHost = false,
  keepRoundsMounted = true, loading = false, error, onDismissError, className = "" }: {
  rounds: InteractiveRound[];
  chat: ReactNode | ((active: boolean) => ReactNode);
  renderRound: (roundId: string) => ReactNode;
  isHost?: boolean;
  keepRoundsMounted?: boolean;
  loading?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  className?: string;
}) {
  const id = useId();
  const [selectedView, setSelectedView] = useState("chat");
  const selected = selectedView === "chat" || rounds.some((round) => round.id === selectedView)
    ? selectedView : rounds[0]?.id ?? "chat";
  const buttonClass = "relative flex h-10 w-[42px] shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500";

  return <section aria-label="Interactive panel" className={`flex h-full min-h-0 min-w-0 overflow-hidden rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 ${className}`}>
    <nav aria-label="Interactive panel views" className="flex w-[67px] shrink-0 flex-col items-center gap-2 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r border-zinc-200 px-3 py-4 dark:border-zinc-800">
      <button type="button" aria-label="Chat" aria-pressed={selected === "chat"} aria-controls={`${id}-chat`}
        onClick={() => setSelectedView("chat")}
        className={`${buttonClass} ${selected === "chat" ? "bg-black" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
        <PanelIcon name="chat" tone={selected === "chat" ? "white" : "foreground"} />
      </button>
      <div aria-hidden="true" className="my-1 h-px w-[42px] shrink-0 bg-zinc-200 dark:bg-zinc-800" />
      {rounds.map((round) => {
        const active = selected === round.id;
        return <button key={round.id} type="button" aria-label={`Round ${round.roundNumber}: ${round.title}`}
          aria-pressed={active} aria-controls={`${id}-${round.id}`} title={`Round ${round.roundNumber}: ${round.title}${isHost && round.state ? ` (${round.state})` : ""}`}
          onClick={() => setSelectedView(round.id)} className={`${buttonClass} ${active ? "bg-black" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
          <PanelIcon name={roundIcons[round.type]} tone={active ? "white" : "foreground"} />
          {isHost && round.state ? <span role="img" aria-label={round.state} className={`absolute right-1 top-1 size-2 rounded-full ring-1 ring-white/80 ${round.state === "active" ? "bg-green-300" : round.state === "closed" ? "bg-red-600" : "bg-yellow-400"}`} /> : null}
        </button>;
      })}
    </nav>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {error ? <div role="alert" className="flex shrink-0 items-center justify-between gap-2 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
        <p>{error}</p><button type="button" onClick={onDismissError} className="underline">Dismiss</button>
      </div> : null}
      <div className="min-h-0 flex-1">
        <MountedPanelView id={`${id}-chat`} active={selected === "chat"}>{typeof chat === "function" ? chat(selected === "chat") : chat}</MountedPanelView>
        {loading && selected !== "chat" ? <p role="status" className="p-4 text-sm text-zinc-500">Loading rounds…</p> : null}
        {!loading ? rounds.filter((round) => keepRoundsMounted || round.id === selected).map((round) =>
          <MountedPanelView key={round.id} id={`${id}-${round.id}`} active={selected === round.id}>
            {renderRound(round.id)}
          </MountedPanelView>) : null}
      </div>
    </div>
  </section>;
}
