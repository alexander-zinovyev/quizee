"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import Member from "../member";

export type TeamMember = {
  /**
   * Stable identifier for keying the rendered Member.
   */
  id: string | number;
  /**
   * Display name rendered in the Member component.
   */
  name: string;
  /**
   * Optional media stream for an active participant.
   */
  stream?: MediaStream | null;
  /**
   * Optional audio track for an active participant.
   */
  audioTrack?: MediaStreamTrack;
  /**
   * Optional video track for an active participant.
   */
  videoTrack?: MediaStreamTrack;
  /**
   * Whether this member has raised their hand.
   */
  handRaised?: boolean;
  /**
   * Optional callback to lower a raised hand.
   */
  onHandClick?: () => void;
  /**
   * Disable audio controls for this member.
   */
  controlsDisabled?: boolean;
  /**
   * Force local mute regardless of controls.
   */
  forceMuted?: boolean;
  /**
   * Whether the Member video should be muted.
   */
  muted?: boolean;
};

export type TeamProps = {
  /**
   * Title shown above the member grid.
   */
  name: string;
  /**
   * Optional total score displayed alongside the team name.
   */
  score?: number | null;
  /**
   * Optional team color to render next to the name.
   */
  color?: string | null;
  /**
   * Participants belonging to the team.
   */
  members: TeamMember[];
  /**
   * Supplementary text rendered under the title.
   */
  description?: string;
  /**
   * Custom class name for the outer wrapper.
   */
  className?: string;
  /**
   * Message displayed when no members are present.
   */
  emptyLabel?: string;
  /**
   * Visual treatment for the team container.
   */
  appearance?: "default" | "bare";
  /**
   * Optional target width for each member tile so multiple teams can align sizes.
   */
  memberSize?: number;
  /**
   * Optional control rendered inline with score.
   */
  scoreAction?: ReactNode;
};

function getGridColumns(count: number) {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

const GRID_GAP_PX = 16;
const MEMBER_LABEL_BLOCK_PX = 28;

type TeamLayout = {
  rows: number;
  columns: number;
  tileWidth: number;
  trackWidth: number;
};

function layoutsMatch(a: TeamLayout | null, b: TeamLayout | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.rows === b.rows &&
    a.columns === b.columns &&
    a.tileWidth === b.tileWidth &&
    a.trackWidth === b.trackWidth
  );
}

function buildLayout(count: number, rows: number, tileWidth: number): TeamLayout {
  const columns = Math.max(1, Math.ceil(count / rows));
  return {
    rows,
    columns,
    tileWidth,
    trackWidth: columns * tileWidth + GRID_GAP_PX * Math.max(0, columns - 1),
  };
}

function pickBestLayout({
  count,
  availableWidth,
  availableHeight,
}: {
  count: number;
  availableWidth: number;
  availableHeight: number;
}): TeamLayout | null {
  if (!count || !availableWidth || !availableHeight) return null;

  const candidateRows = Array.from({ length: count }, (_, index) => index + 1);
  let bestLayout: TeamLayout | null = null;

  for (const rows of candidateRows) {
    const columns = Math.max(1, Math.ceil(count / rows));
    const widthPerTile =
      (availableWidth - GRID_GAP_PX * Math.max(0, columns - 1)) / columns;
    const videoHeightPerTile =
      (
        availableHeight -
        GRID_GAP_PX * Math.max(0, rows - 1) -
        MEMBER_LABEL_BLOCK_PX * rows
      ) / rows;
    const widthFromHeight = videoHeightPerTile * (16 / 9);
    const tileWidth = Math.floor(Math.min(widthPerTile, widthFromHeight));

    if (tileWidth <= 0) continue;

    const nextLayout = buildLayout(count, rows, tileWidth);

    if (!bestLayout || nextLayout.tileWidth > bestLayout.tileWidth) {
      bestLayout = nextLayout;
      continue;
    }

    if (
      nextLayout.tileWidth === bestLayout.tileWidth &&
      nextLayout.rows < bestLayout.rows
    ) {
      bestLayout = nextLayout;
    }
  }

  return bestLayout;
}

export default function Team({
  name,
  color,
  score,
  members,
  className,
  emptyLabel = "No members in this team yet.",
  description,
  appearance = "default",
  memberSize,
  scoreAction,
}: TeamProps) {
  const memberCount = members.length;
  const isBare = appearance === "bare";
  const memberAreaRef = useRef<HTMLDivElement>(null);
  const [calculatedLayout, setCalculatedLayout] = useState<TeamLayout | null>(null);

  useLayoutEffect(() => {
    if (memberSize || !memberCount) return;

    if (typeof ResizeObserver === "undefined" || !memberAreaRef.current) return;

    const memberAreaElement = memberAreaRef.current;

    const computeLayout = () => {
      const nextLayout = pickBestLayout({
        count: memberCount,
        availableWidth: memberAreaElement.clientWidth,
        availableHeight: memberAreaElement.clientHeight,
      });

      setCalculatedLayout((previousLayout) =>
        layoutsMatch(previousLayout, nextLayout) ? previousLayout : nextLayout
      );
    };

    const observer = new ResizeObserver(() => {
      computeLayout();
    });
    observer.observe(memberAreaElement);

    const frameId = window.requestAnimationFrame(computeLayout);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [memberCount, memberSize]);

  const manualColumns = getGridColumns(memberCount);
  const manualLayout =
    memberSize && memberCount
      ? buildLayout(memberCount, Math.ceil(memberCount / manualColumns), memberSize)
      : null;
  const effectiveLayout = manualLayout ?? calculatedLayout;
  const fallbackGridTemplateColumns = memberCount
    ? `repeat(${manualColumns}, minmax(0, 1fr))`
    : undefined;

  const alignEnd = (className ?? "").includes("text-right");

  return (
    <section
      className={["flex h-full min-h-0 w-full flex-col overflow-hidden", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={name}
    >
      <div
        className={[
          "flex w-full flex-1 flex-col",
          isBare
            ? "gap-2 text-zinc-900 dark:text-zinc-100"
            : "rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <p
          className={`text-xs font-semibold uppercase tracking-[0.3em] ${
            isBare
              ? "text-emerald-500/80 dark:text-emerald-300/80"
              : "text-emerald-500"
          }`}
        >
          TEAM
        </p>
        <div className={isBare ? "space-y-1" : "mb-4"}>
        <div
          className={[
            "flex w-full items-center gap-2",
            alignEnd ? "justify-end text-right" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {color ? (
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: color }}
                aria-hidden
              />
            ) : null}
            <h2
              className={[
                "text-2xl font-semibold text-zinc-900 dark:text-zinc-50",
                alignEnd ? "text-right" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {name}
            </h2>
            {typeof score === "number" ? (
              <span className="text-lg font-semibold text-emerald-500 dark:text-emerald-300">
                {score}
              </span>
            ) : null}
            {scoreAction}
          </div>
          {description ? (
            <p
              className={`text-sm text-zinc-500 dark:text-zinc-400 ${
                isBare ? "" : "mt-1"
              }`}
            >
              {description}
            </p>
          ) : null}
        </div>
        <div className={`flex flex-1 min-h-0 flex-col ${isBare ? "gap-3" : "gap-4"}`}>
          {memberCount ? (
            <div
              ref={memberAreaRef}
              className="flex flex-1 min-h-0 items-center justify-center"
            >
              {effectiveLayout ? (
                <div
                  className="flex flex-wrap content-center justify-center gap-4"
                  style={{ width: `${effectiveLayout.trackWidth}px`, maxWidth: "100%" }}
                >
                  {members.map((member, index) => {
                    const key = member?.id ?? member?.name ?? `slot-${index}`;
                    return (
                      <div
                        key={key}
                        className="flex flex-col"
                        style={{
                          width: `${effectiveLayout.tileWidth}px`,
                          maxWidth: `${effectiveLayout.tileWidth}px`,
                          flex: `0 0 ${effectiveLayout.tileWidth}px`,
                        }}
                      >
                        <Member
                          name={member.name}
                          stream={member.stream}
                          audioTrack={member.audioTrack}
                          videoTrack={member.videoTrack}
                          handRaised={member.handRaised}
                          onHandClick={member.onHandClick}
                          controlsDisabled={member.controlsDisabled}
                          forceMuted={member.forceMuted}
                          muted={member.muted}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="grid w-full flex-1 content-center justify-items-center gap-4"
                  style={{ gridTemplateColumns: fallbackGridTemplateColumns }}
                >
                  {members.map((member, index) => {
                    const key = member?.id ?? member?.name ?? `slot-${index}`;
                    return (
                      <div key={key} className="flex w-full flex-col">
                        <Member
                          name={member.name}
                          stream={member.stream}
                          audioTrack={member.audioTrack}
                          videoTrack={member.videoTrack}
                          handRaised={member.handRaised}
                          onHandClick={member.onHandClick}
                          controlsDisabled={member.controlsDisabled}
                          forceMuted={member.forceMuted}
                          muted={member.muted}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {emptyLabel}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
