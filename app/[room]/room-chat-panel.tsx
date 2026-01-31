"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import Chat, { type ChatMessage } from "@/components/chat";
import type { RoomRosterTeam } from "./room-layout-types";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type Channel = {
  id: string;
  label: string;
  path: string[];
  canSend: boolean;
};

type RoomChatPanelProps = {
  roomSlug: string;
  teams?: RoomRosterTeam[];
  viewerTeamId?: string | null;
  isHost?: boolean;
  viewerName?: string | null;
  memberNames?: Record<string, string>;
  className?: string;
};

export default function RoomChatPanel({
  roomSlug,
  teams = [],
  viewerTeamId,
  isHost,
  viewerName,
  memberNames = {},
  className,
}: RoomChatPanelProps) {
  const { user } = useFirebaseAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string>("room");
  const memberNamesKey = useMemo(
    () => Object.entries(memberNames).map(([id, name]) => `${id}:${name}`).join("|"),
    [memberNames]
  );

  const channels: Channel[] = useMemo(() => {
    const base: Channel[] = [
      {
        id: "room",
        label: "Room",
        path: ["rooms", roomSlug, "messages"],
        canSend: true,
      },
    ];

    if (isHost) {
      teams.forEach((team) => {
        base.push({
          id: `team-${team.id}`,
          label: team.name,
          path: ["rooms", roomSlug, "teams", team.id, "messages"],
          canSend: true,
        });
      });
    } else if (viewerTeamId) {
      const team = teams.find((t) => t.id === viewerTeamId);
      if (team) {
        base.push({
          id: `team-${team.id}`,
          label: team.name,
          path: ["rooms", roomSlug, "teams", team.id, "messages"],
          canSend: true,
        });
      }
    }

    return base;
  }, [isHost, roomSlug, teams, viewerTeamId]);

  const activeChannel = channels.find((ch) => ch.id === activeChannelId) ?? channels[0];

  useEffect(() => {
    if (!activeChannel) return;
    const db = getClientFirestore();
    const messagesRef = collection(
      db,
      ...(activeChannel.path as [string, ...string[]])
    );
    const messagesQuery = query(messagesRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const nextMessages: ChatMessage[] = snapshot.docs.map((docSnap, index) => {
        const data = docSnap.data();
        const created = data.createdAt?.toDate?.() as Date | undefined;
        const timestamp =
          created?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";
        const uid = (data.uid as string | undefined) ?? "";
        const author =
          (uid && memberNames?.[uid]) ||
          (data.author as string | undefined) ||
          "Player";
        const content = (data.content as string | undefined) ?? "";

        return {
          id: docSnap.id ?? index,
          author,
          content,
          timestamp,
          isSelf: uid && user?.uid ? uid === user.uid : false,
        };
      });
      setMessages(nextMessages);
    });

    return () => unsubscribe();
  }, [activeChannel, memberNamesKey, user?.uid]);

  async function handleSend(text: string) {
    if (!activeChannel?.canSend) return;
    const author = viewerName?.trim();
    if (!author) {
      console.warn("[room-chat] Missing viewer name; cannot send message.");
      return;
    }
    const db = getClientFirestore();
    const messagesRef = collection(
      db,
      ...(activeChannel.path as [string, ...string[]])
    );
    await addDoc(messagesRef, {
      author,
      content: text,
      uid: user?.uid ?? null,
      createdAt: serverTimestamp(),
    });
  }

  return (
    <div className={["flex h-full min-h-0 flex-col", className ?? ""].filter(Boolean).join(" ")}>
      <div className="mb-3 flex items-center gap-2 overflow-x-auto rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-emerald-200 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
        {channels.map((channel) => {
          const isActive = channel.id === activeChannel?.id;
          return (
            <button
              key={channel.id}
              onClick={() => setActiveChannelId(channel.id)}
              className={`shrink-0 rounded-full px-3 py-1 transition ${
                isActive
                  ? "bg-emerald-500 text-white shadow-sm"
                  : "text-emerald-600 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
              }`}
              type="button"
            >
              {channel.label}
            </button>
          );
        })}
      </div>

      <Chat
        title={activeChannel?.label ?? "Chat"}
        messages={messages}
        onSend={handleSend}
        placeholder="Send a message…"
        className="flex-1 min-h-0"
        autoSize={false}
      />
    </div>
  );
}
