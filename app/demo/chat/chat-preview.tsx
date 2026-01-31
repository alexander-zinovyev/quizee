"use client";

import { useState } from "react";
import Chat, { type ChatMessage } from "@/components/chat";

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    author: "Quizmaster",
    content: "Welcome to the lorem trivia room! Feel free to coordinate with your teammates here.",
    timestamp: "09:00",
    accentColor: "#a855f7",
  },
  {
    id: "team-1",
    author: "Jess P.",
    content: "Heads-up: I grabbed the puzzle round, so someone else can take image clues.",
    timestamp: "09:02",
  },
  {
    id: "team-2",
    author: "Marco",
    content: "I'll decode the cipher 🔐",
    timestamp: "09:04",
  },
  {
    id: "self-1",
    author: "You",
    content: "Nice. I'll keep an eye on the rapid-fire questions.",
    timestamp: "09:05",
    isSelf: true,
  },
  {
    id: "self-2",
    author: "You",
    content: "One more message to test the scroll.",
    timestamp: "09:06",
    isSelf: true,
  },
];

export default function ChatPreview() {
  const [messages, setMessages] = useState(initialMessages);
  const [messageCount, setMessageCount] = useState(initialMessages.length);

  const timestamp = () =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  function handleSend(text: string) {
    const payload: ChatMessage = {
      id: `demo-${messageCount + 1}`,
      author: "You",
      content: text,
      timestamp: timestamp(),
      isSelf: true,
    };

    setMessages((prev) => [...prev, payload]);
    setMessageCount((prev) => prev + 1);
  }

  return (
    <Chat
      title="Squad chat"
      messages={messages}
      onSend={handleSend}
      placeholder="Type a message with formatting or emoji..."
      className="min-h-[28rem] lg:self-start"
    />
  );
}
