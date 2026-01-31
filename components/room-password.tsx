"use client";

import { FormEvent, useState } from "react";

type RoomPasswordProps = {
  /**
   * Optional action to execute when the password is submitted.
   */
  onSubmit?: (password: string) => Promise<void> | void;
  /**
   * Display name for the room being joined.
   */
  roomName?: string;
  /**
   * External error message, for example from a failed request.
   */
  errorMessage?: string;
  /**
   * Control the loading state externally if desired.
   */
  isLoading?: boolean;
};

export default function RoomPassword({
  onSubmit,
  roomName,
  errorMessage,
  isLoading: isLoadingProp,
}: RoomPasswordProps) {
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoading = isLoadingProp ?? isSubmitting;
  const error = errorMessage ?? localError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password.trim()) {
      setLocalError("Password is required.");
      return;
    }

    setLocalError(null);

    if (!onSubmit) return;

    try {
      setIsSubmitting(true);
      await onSubmit(password.trim());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white/80 p-6 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80"
    >
      <header className="space-y-1 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Locked room
        </p>
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">
          Enter password
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {roomName
            ? `Room “${roomName}” is locked. Enter the password to continue.`
            : "This room requires a password before you can join."}
        </p>
      </header>

      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">
        Password
        <input
          type="password"
          name="room-password"
          autoComplete="current-password"
          value={password}
          required
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-4 py-2 text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/30"
          placeholder="••••••"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "room-password-error" : undefined}
          disabled={isLoading}
        />
      </label>

      {error ? (
        <p id="room-password-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-300 dark:focus:ring-offset-zinc-900"
      >
        {isLoading ? "Joining..." : "Join room"}
      </button>
    </form>
  );
}
