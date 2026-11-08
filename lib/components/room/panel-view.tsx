"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";

type Position = { x: number; y: number };

function FloatingWindow({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const descriptionId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; start: Position; origin: Position } | null>(null);
  const [position, setPosition] = useState<Position>({ x: 16, y: 16 });

  const constrain = useCallback((next: Position): Position => {
    const element = ref.current;
    if (!element) return next;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    return {
      x: Math.max(left + 8, Math.min(next.x, left + width - element.offsetWidth - 8)),
      y: Math.max(top + 8, Math.min(next.y, top + height - element.offsetHeight - 8)),
    };
  }, []);

  useLayoutEffect(() => {
    const resize = () => {
      const viewport = window.visualViewport;
      if (ref.current) {
        ref.current.style.width = `${Math.min(480, (viewport?.width ?? window.innerWidth) - 16)}px`;
        ref.current.style.maxHeight = `${(viewport?.height ?? window.innerHeight) - 16}px`;
      }
      setPosition((current) => constrain(current));
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [constrain]);

  return <div ref={ref} role="dialog" aria-label={`${title} window`} aria-modal={false}
    className="fixed z-40 flex h-[420px] w-[min(480px,calc(100vw-16px))] max-h-[calc(100dvh-16px)] flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
    style={{ left: position.x, top: position.y }}>
    <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
      <button type="button" aria-label={`Move ${title} window`} aria-describedby={descriptionId}
        className="flex min-w-0 flex-1 touch-none cursor-grab items-center gap-2 rounded-lg p-2 text-left text-sm font-semibold active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-emerald-500"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: position };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          setPosition(constrain({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y }));
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          const direction: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
          const delta = direction[event.key];
          if (!delta) return;
          event.preventDefault();
          const step = event.shiftKey ? 64 : 16;
          setPosition((current) => constrain({ x: current.x + delta.x * step, y: current.y + delta.y * step }));
        }}>
        <GripHorizontal aria-hidden="true" className="size-5 shrink-0" /><span className="truncate">{title}</span>
      </button>
      <span id={descriptionId} className="sr-only">Drag or use arrow keys to move this window.</span>
      <button type="button" aria-label="Close window" onClick={onClose}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:hover:bg-zinc-800">
        <X aria-hidden="true" className="size-5" />
      </button>
    </header>
    {children}
  </div>;
}

/** Move a stable portal container so changing location never remounts live tab content. */
export function PanelView({ id, title, active, floating, onClose, children }: {
  id: string; title: string; active: boolean; floating: boolean; onClose: () => void; children: ReactNode;
}) {
  const inlineSlot = useRef<HTMLDivElement | null>(null);
  const windowSlot = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const attachInline = useCallback((element: HTMLDivElement | null) => {
    inlineSlot.current = element;
    if (element) setContainer((current) => {
      if (current) return current;
      const next = document.createElement("div");
      next.className = "h-full min-h-0 min-w-0";
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (!container) return;
    const slot = floating ? windowSlot.current : inlineSlot.current;
    slot?.appendChild(container);
  }, [container, floating]);

  useLayoutEffect(() => {
    if (active || floating) return;
    container?.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
  }, [container, active, floating]);

  useLayoutEffect(() => () => { container?.remove(); }, [container]);

  return <>
    <div ref={attachInline} id={id} hidden={!active || floating} className="h-full min-h-0 min-w-0" />
    {container ? createPortal(children, container) : null}
    {container && floating ? createPortal(<FloatingWindow title={title} onClose={onClose}>
      <div ref={windowSlot} className="min-h-0 min-w-0 flex-1" />
    </FloatingWindow>, container.ownerDocument.body) : null}
  </>;
}
