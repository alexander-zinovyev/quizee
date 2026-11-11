"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import Chat, { type ChatMessage } from "@/lib/components/chat";
import type { RoomRosterTeam } from "./room-layout-types";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type Channel = {
  id: string;
  label: string;
  path: string;
  canSend: boolean;
};

type StoredChatMessage = ChatMessage & { uid: string };

type RoomChatPanelProps = {
  roomSlug: string;
  teams?: RoomRosterTeam[];
  viewerTeamId?: string | null;
  isHost?: boolean;
  viewerName?: string | null;
  memberNames?: Record<string, string>;
  className?: string;
  active?: boolean;
};

const EMPTY_TEAMS: RoomRosterTeam[] = [];
const EMPTY_MEMBER_NAMES: Record<string, string> = {};

export default function RoomChatPanel({
  roomSlug,
  teams = EMPTY_TEAMS,
  viewerTeamId,
  isHost,
  viewerName,
  memberNames = EMPTY_MEMBER_NAMES,
  className,
  active = true,
}: RoomChatPanelProps) {
  const { user } = useFirebaseAuth();
  const [history, setHistory] = useState<{ path: string; messages: StoredChatMessage[]; error?: string } | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string>("room");

  const channels: Channel[] = useMemo(() => {
    const base: Channel[] = [
      {
        id: "room",
        label: "All",
        path: `rooms/${roomSlug}/messages`,
        canSend: true,
      },
    ];

    if (isHost) {
      teams.forEach((team) => {
        base.push({
          id: `team-${team.id}`,
          label: team.name,
          path: `rooms/${roomSlug}/teams/${team.id}/messages`,
          canSend: true,
        });
      });
    } else if (viewerTeamId) {
      const team = teams.find((t) => t.id === viewerTeamId);
      if (team) {
        base.push({
          id: `team-${team.id}`,
          label: "Team",
          path: `rooms/${roomSlug}/teams/${team.id}/messages`,
          canSend: true,
        });
      }
    }

    return base;
  }, [isHost, roomSlug, teams, viewerTeamId]);

  const activeChannel = channels.find((ch) => ch.id === activeChannelId) ?? channels[0];
  const channelPath = activeChannel.path;

  useEffect(() => {
    const db = getClientFirestore();
    const messagesRef = collection(db, channelPath);
    const messagesQuery = query(messagesRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const nextMessages: StoredChatMessage[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const created = data.createdAt?.toDate?.() as Date | undefined;
        const timestamp =
          created?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";
        const uid = (data.uid as string | undefined) ?? "";
        const author = (data.author as string | undefined) || "Player";
        const content = (data.content as string | undefined) ?? "";

        return {
          id: docSnap.id,
          uid,
          author,
          content,
          timestamp,
        };
      });
      setHistory({ path: channelPath, messages: nextMessages });
    }, () => setHistory({ path: channelPath, messages: [], error: "Unable to load chat messages." }));

    return () => unsubscribe();
  }, [channelPath]);

  // Roster/name updates change presentation, not the Firestore subscription.
  const messages = useMemo(() => history?.path === channelPath ? history.messages.map((message) => ({
    ...message,
    author: memberNames[message.uid] || message.author,
    isSelf: Boolean(message.uid && message.uid === user?.uid),
  })) : [], [channelPath, history, memberNames, user?.uid]);

  async function handleSend(text: string) {
    if (!activeChannel?.canSend) return;
    const author = viewerName?.trim();
    if (!author) {
      throw new Error("A player name is required to send a message.");
    }
    const db = getClientFirestore();
    const messagesRef = collection(db, channelPath);
    await addDoc(messagesRef, {
      author,
      content: text,
      uid: user?.uid ?? null,
      createdAt: serverTimestamp(),
    });
  }

  return (
    <div className={["flex h-full min-h-0 flex-col", className ?? ""].filter(Boolean).join(" ")}>
      <nav aria-label="Chat channels" className="flex shrink-0 items-center gap-1 overflow-x-auto bg-zinc-200/70 px-4 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500 dark:bg-zinc-800/70">
        {channels.map((channel) => {
          const isActive = channel.id === activeChannel?.id;
          return (
            <button
              key={channel.id}
              onClick={() => setActiveChannelId(channel.id)}
              aria-pressed={isActive}
              className={`shrink-0 rounded-t-lg px-4 py-2 transition ${
                isActive
                  ? "bg-white dark:bg-zinc-900"
                  : "hover:bg-white/50 dark:hover:bg-zinc-700"
              }`}
              type="button"
            >
              {channel.label}
            </button>
          );
        })}
      </nav>

      {history?.path === channelPath && history.error ? <p role="alert" className="px-3 pt-3 text-sm text-red-600">{history.error}</p> : null}

      <Chat
        title={activeChannel?.label ?? "Chat"}
        messages={messages}
        onSend={handleSend}
        placeholder="Send a message…"
        className="flex-1 min-h-0"
        autoSize={false}
        embedded
        active={active}
        disabled={!viewerName?.trim()}
      />
    </div>
  );
}
