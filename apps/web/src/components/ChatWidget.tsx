import { useEffect, useRef, useState } from "react";
import { SocketEvents } from "../lib/events";
import { socket } from "../lib/socket";
import { useApp } from "../store/app";

interface ChatEntry {
  id: string;
  username: string;
  message: string;
  role: string;
  vipTier: string | null;
  at: string;
}

/** Floating lobby chat. Hidden until opened so it never blocks the board. */
export function ChatWidget() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onHistory = (payload: { messages: ChatEntry[] }) => setMessages(payload.messages);
    const onMessage = (payload: ChatEntry) => setMessages((prev) => [...prev.slice(-99), payload]);

    socket.on(SocketEvents.CHAT_HISTORY, onHistory);
    socket.on(SocketEvents.CHAT_MESSAGE, onMessage);
    return () => {
      socket.off(SocketEvents.CHAT_HISTORY, onHistory);
      socket.off(SocketEvents.CHAT_MESSAGE, onMessage);
    };
  }, []);

  useEffect(() => {
    if (open) socket.emit("chat:join", { channel: "lobby" });
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!draft.trim()) return;
    socket.emit("chat:send", { channel: "lobby", message: draft }, (ack: { ok: boolean; error?: string }) => {
      if (!ack.ok) setError(ack.error ?? "Could not send");
      else setDraft("");
    });
  };

  if (!open) {
    return (
      <button
        className="btn btn-primary"
        style={{ position: "fixed", bottom: 24, left: 24, zIndex: 500, borderRadius: 99, padding: "12px 20px", boxShadow: "var(--shadow)" }}
        onClick={() => setOpen(true)}
      >
        Sohbet
      </button>
    );
  }

  return (
    <div
      className="card chat-panel"
      style={{ position: "fixed", bottom: 24, left: 24, width: 340, zIndex: 500, boxShadow: "var(--shadow)" }}
    >
      <div className="row-between mb">
        <span className="bold">Lobi Sohbeti</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>✕</button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && <div className="small faint center">No messages yet. Be the first to write!</div>}
        {messages.map((message) => (
          <div className="chat-msg" key={message.id}>
            {message.vipTier && <span className="pill pill-vip" style={{ fontSize: 9, padding: "1px 6px", marginRight: 4 }}>{message.vipTier}</span>}
            <span className="who">{message.username}</span>
            <span className="when">{new Date(message.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
            <div>{message.message}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className="tiny" style={{ color: "var(--danger)" }}>{error}</div>}

      <form className="row mt" style={{ gap: 6 }} onSubmit={send}>
        <input
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={user ? "Write a message..." : "Log in to chat"}
          disabled={!user}
          maxLength={300}
        />
        <button className="btn btn-primary" type="submit" disabled={!user || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}
