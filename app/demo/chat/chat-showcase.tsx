"use client";

import { useEffect, useRef, useState } from "react";
import ChatPreview from "./chat-preview";

export default function ChatShowcase() {
  const chatWrapperRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = chatWrapperRef.current;
    if (!node) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setChatWidth(entry.contentRect.width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const helperStyle = chatWidth ? { width: `${chatWidth}px` } : undefined;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <section
        className="rounded-3xl border border-dashed border-zinc-200 bg-white/70 p-8 text-left shadow-inner dark:border-zinc-800 dark:bg-zinc-900/60"
        style={helperStyle}
      >
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">What to test</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Switch between desktop and mobile widths to see how the chat panel responds.</li>
          <li>Use the bold, italic, underline, and strikethrough buttons to wrap selected text.</li>
          <li>Add emoji reactions from the picker, or type them directly in the composer.</li>
          <li>Submit a message to watch it append in the live feed with your avatar.</li>
        </ul>
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          In the real product, messages sync between teammates; here they simply demonstrate the component&apos;s
          styling and UX.
        </p>
      </section>

      <div ref={chatWrapperRef}>
        <ChatPreview />
      </div>
    </div>
  );
}
