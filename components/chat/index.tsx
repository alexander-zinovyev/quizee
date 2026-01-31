"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

export type ChatMessage = {
  /**
   * Stable identifier for React rendering.
   */
  id?: string | number;
  /**
   * Visible name next to the message.
   */
  author: string;
  /**
   * Text or custom node shown as the message body.
   */
  content: string | ReactNode;
  /**
   * Optional text timestamp.
   */
  timestamp?: string;
  /**
   * Custom background accent for the avatar bubble.
   */
  accentColor?: string;
  /**
   * Style message as if it was sent by the current participant.
   */
  isSelf?: boolean;
};

export type ChatProps = {
  /**
   * Header title rendered above the chat list.
   */
  title?: string;
  /**
   * Collection of chat messages to display.
   */
  messages: ChatMessage[];
  /**
   * Fires when the composer form is submitted.
   */
  onSend?: (message: string) => void;
  /**
   * Placeholder inside the textarea.
   */
  placeholder?: string;
  /**
   * Disables the composer controls.
   */
  disabled?: boolean;
  /**
   * Custom container classes.
   */
  className?: string;
  /**
   * Enables responsive 16:9 sizing relative to the viewport.
   */
  autoSize?: boolean;
};

const formattingTokens = {
  bold: {
    label: "Bold",
    hotkey: "⌘B",
    symbol: "B",
    decoration: "**",
  },
  italic: {
    label: "Italic",
    hotkey: "⌘I",
    symbol: "I",
    decoration: "*",
  },
  underline: {
    label: "Underline",
    hotkey: "⌘U",
    symbol: "U",
    decoration: "<u>",
    closing: "</u>",
  },
  strikethrough: {
    label: "Strikethrough",
    hotkey: "⌘S",
    symbol: "S",
    decoration: "~~",
  },
} as const;

const emojiPalette = ["😀", "🎉", "🔥", "🚀", "🙌", "🤔", "❤️", "👏"];
const CHAT_ASPECT_RATIO = 16 / 9;

export default function Chat({
  title = "Live chat",
  messages,
  onSend,
  placeholder = "Send a message to everyone…",
  disabled = false,
  className,
  autoSize = true,
}: ChatProps) {
  const [value, setValue] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [chatSize, setChatSize] = useState<{ width: number; height: number } | null>(null);
  const [composerActive, setComposerActive] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const canSend = value.trim().length > 0 && !disabled;

  const orderedMessages = useMemo(
    () => messages.map((message, index) => ({ ...message, key: message.id ?? index })),
    [messages],
  );

  useEffect(() => {
    if (!autoSize) {
      setChatSize(null);
      return;
    }

    function updateChatSize() {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (viewportWidth < 1024) {
        setChatSize(null);
        return;
      }

      const targetArea = viewportWidth * viewportHeight * 0.25;
      let width = Math.sqrt(targetArea * CHAT_ASPECT_RATIO);
      let height = width / CHAT_ASPECT_RATIO;

      const widthScale = viewportWidth / width;
      const heightScale = viewportHeight / height;
      const scale = Math.min(1, widthScale, heightScale);

      width *= scale;
      height *= scale;

      setChatSize({
        width,
        height,
      });
    }

    updateChatSize();
    window.addEventListener("resize", updateChatSize);
    return () => window.removeEventListener("resize", updateChatSize);
  }, [autoSize]);

  useEffect(() => {
    if (!composerActive) {
      setShowEmojis(false);
    }
  }, [composerActive]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const behavior = hasAutoScrolledRef.current ? "smooth" : "auto";
      scrollToBottom(behavior);
      hasAutoScrolledRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [orderedMessages]);

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  function renderContent(content: string | ReactNode) {
    if (typeof content !== "string") {
      return content;
    }

    return content.split("\n").map((segment, index, list) => (
      <span key={`${segment}-${index}`}>
        {segment}
        {index < list.length - 1 ? <br /> : null}
      </span>
    ));
  }

  function applyFormatting(type: keyof typeof formattingTokens) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) {
      return;
    }

    const token = formattingTokens[type];
    const open = token.decoration;
    const close = token.closing ?? token.decoration;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = value.slice(start, end);
    const newValue =
      value.slice(0, start) + open + (selected || "text") + close + value.slice(end);

    setValue(newValue);

    requestAnimationFrame(() => {
      const cursorPosition = start + open.length + (selected ? selected.length : 4);
      textarea.focus();
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function appendEmoji(emoji: string) {
    if (disabled) {
      return;
    }
    setValue((prev) => `${prev}${emoji}`);
    setShowEmojis(false);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendCurrentMessage();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  }

  function sendCurrentMessage() {
    if (!canSend) {
      return;
    }

    const trimmed = value.trim();
    onSend?.(trimmed);
    setValue("");
    setShowEmojis(false);
    requestAnimationFrame(() => scrollToBottom("smooth"));
  }

  const containerClasses = [
    "flex h-full w-full min-h-0 flex-col rounded-3xl border border-zinc-200 bg-white/90 p-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90",
    "lg:flex-shrink-0",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const sectionStyle = autoSize && chatSize
    ? { width: `${chatSize.width}px`, height: `${chatSize.height}px` }
    : undefined;

  return (
    <section className={containerClasses} aria-label={title} style={sectionStyle}>
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
          Chat
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-hidden">
        <div
          ref={messagesContainerRef}
          className="flex-1 space-y-2 overflow-y-auto pr-1 pb-4 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100"
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
        >
          {orderedMessages.length ? (
            orderedMessages.map((message) => (
              <article key={message.key} className="flex flex-col">
                <div className="flex flex-row items-baseline gap-2">
                  <time
                    dateTime={message.timestamp}
                    className="mt-[1px] text-[11px] uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                  >
                    {message.timestamp}
                  </time>
                  <span className="font-semibold">{message.author}</span>
                  <div className="flex-1 whitespace-pre-wrap break-words">
                    {renderContent(message.content)}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No chat activity yet. Be the first to start the conversation!
            </p>
          )}
        </div>

        <form
          className="relative rounded-2xl border border-zinc-200 bg-white/95 p-3 dark:border-zinc-800 dark:bg-zinc-900/95"
          onSubmit={handleSubmit}
          onFocusCapture={() => setComposerActive(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setComposerActive(false);
            }
          }}
        >
          {composerActive ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
              {(
                Object.entries(formattingTokens) as Array<
                  [keyof typeof formattingTokens, (typeof formattingTokens)[keyof typeof formattingTokens]]
                >
              ).map(([key, token]) => (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => applyFormatting(key)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-xs font-semibold text-zinc-600 transition hover:border-emerald-200 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-400/60 dark:hover:text-emerald-300"
                  aria-label={`${token.label} (${token.hotkey})`}
                >
                  {token.symbol}
                </button>
              ))}
              <div className="relative ml-auto">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setShowEmojis((prev) => !prev)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-sm transition hover:border-emerald-200 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-400/60 dark:hover:text-emerald-300"
                  aria-haspopup="true"
                  aria-expanded={showEmojis}
                  aria-label="Insert emoji"
                >
                  😊
                </button>
                {showEmojis ? (
                  <div className="absolute right-0 top-10 z-10 flex w-48 flex-wrap gap-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                    {emojiPalette.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        disabled={disabled}
                        onClick={() => appendEmoji(emoji)}
                        className="text-lg transition hover:scale-110"
                        aria-label={`Insert ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <label className="sr-only" htmlFor="chat-message">
            Message input
          </label>
          <textarea
            id="chat-message"
            ref={textareaRef}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={placeholder}
            rows={composerActive ? 3 : 1}
            className={`w-full resize-none rounded-xl border border-transparent bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-300 focus:px-3 focus:py-2 focus:outline-none dark:text-white ${
              composerActive ? "mt-3" : ""
            }`}
          />

          {composerActive ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Press Shift + Enter for a new line</span>
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
