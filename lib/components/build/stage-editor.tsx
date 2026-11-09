"use client";

import type { MediaTreeFile } from "./media-tree-shared";
import MediaSelector from "./media-selector";

export type Stage = {
  id: string;
  collapsed: boolean;
  text: string;
  mediaPath: string | null;
};

export function createStage(): Stage {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    collapsed: false,
    text: "",
    mediaPath: null,
  };
}

export function StageEditor({
  stage,
  mediaFiles,
  onChange,
  onRemove,
  title,
}: {
  stage: Stage;
  mediaFiles: MediaTreeFile[];
  onChange: (next: Stage) => void;
  onRemove?: () => void;
  title: string;
}) {
  const inlineLabelClass =
    "w-12 px-1 text-sm font-semibold text-zinc-700 dark:text-white";

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...stage, collapsed: !stage.collapsed })}
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
            title={stage.collapsed ? "Expand" : "Collapse"}
          >
            {stage.collapsed ? "▸" : "▾"}
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</p>
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-sm font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
            aria-label="Remove stage"
            title="Remove stage"
          >
            ×
          </button>
        ) : null}
      </div>
      {!stage.collapsed ? (
        <>
          <div className="flex items-start gap-2">
            <p className={inlineLabelClass}>
              Text
            </p>
            <textarea
              value={stage.text}
              onChange={(event) => onChange({ ...stage, text: event.target.value })}
              rows={3}
              placeholder="Write your text..."
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <p className={inlineLabelClass}>
              Media
            </p>
            <div className="min-w-0 flex-1">
              <MediaSelector
                value={stage.mediaPath}
                mediaFiles={mediaFiles}
                onChange={(mediaPath) => onChange({ ...stage, mediaPath })}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
