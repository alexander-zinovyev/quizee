"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
};

function getGridColumns(count: number) {
  if (count <= 0) return 1;
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

export default function Team({
  name,
  color,
  members,
  className,
  emptyLabel = "No members in this team yet.",
  description,
  appearance = "default",
  memberSize,
}: TeamProps) {
  const memberCount = members.length;
  const isBare = appearance === "bare";
  const columns = getGridColumns(memberCount);
  const gridTemplateColumns = memberCount
    ? `repeat(${columns}, minmax(0, 1fr))`
    : undefined;
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    if (!sectionRef.current || !contentRef.current) return;

    const sectionEl = sectionRef.current;
    const contentEl = contentRef.current;

    const computeScale = () => {
      const availableHeight = sectionEl.clientHeight;
      const contentHeight = contentEl.scrollHeight;

      if (!availableHeight || !contentHeight) {
        setScale(1);
        return;
      }

      const nextScale = Math.min(1, availableHeight / contentHeight);
      setScale((prev) => (Math.abs(prev - nextScale) > 0.01 ? nextScale : prev));
    };

    const observer = new ResizeObserver(computeScale);
    observer.observe(sectionEl);
    observer.observe(contentEl);
    computeScale();

    return () => observer.disconnect();
  }, []);

  const contentStyle =
    scale < 1
      ? {
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }
      : undefined;

  const alignEnd = (className ?? "").includes("text-right");

  return (
    <section
      ref={sectionRef}
      className={["flex h-full min-h-0 w-full flex-col overflow-hidden", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={name}
    >
      <div
        ref={contentRef}
        className={[
          "flex w-full flex-1 flex-col",
          isBare
            ? "gap-2 text-zinc-900 dark:text-zinc-100"
            : "rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={contentStyle}
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
              className="grid flex-1 content-center justify-items-center gap-4 md:gap-5"
              style={{ gridTemplateColumns }}
            >
              {members.map((member, index) => {
                const key = member?.id ?? member?.name ?? `slot-${index}`;
                return (
                  <div
                    key={key}
                    className="flex flex-col"
                    style={
                      memberSize
                        ? {
                            width: `${memberSize}px`,
                            maxWidth: `${memberSize}px`,
                            flex: `0 0 ${memberSize}px`,
                          }
                        : undefined
                    }
                  >
                    <Member
                      name={member.name}
                      stream={member.stream}
                      audioTrack={member.audioTrack}
                      videoTrack={member.videoTrack}
                      controlsDisabled={member.controlsDisabled}
                      forceMuted={member.forceMuted}
                      muted={member.muted}
                    />
                  </div>
                );
              })}
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
