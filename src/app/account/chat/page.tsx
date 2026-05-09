"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";

// ── types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── suggested prompts ──────────────────────────────────────────────────────────

const SUGGESTED = [
  { icon: "💰", text: "What is my current savings rate and is it healthy?" },
  { icon: "🚨", text: "What's the biggest risk in my finances right now?" },
  { icon: "🏦", text: "How long until I hit my emergency fund goal?" },
  { icon: "💳", text: "Which debt should I pay off first and why?" },
  { icon: "📈", text: "Am I on track to improve my net worth this year?" },
  { icon: "✂️",  text: "Where can I realistically cut my spending?" },
];

// ── markdown-ish renderer ──────────────────────────────────────────────────────
// Converts **bold**, bullet lines, pipe tables, and line breaks without a full MD lib

function parsePipeTableRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t.slice(1, -1).split("|").map((c) => c.trim());
}

function isTableSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

function TableView({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const header = rows[0]!;
  let dataStart = 1;
  if (rows.length > 1 && isTableSeparatorRow(rows[1]!)) dataStart = 2;
  const body = rows.slice(dataStart);
  return (
    <div className="my-2 -mx-1 max-w-full overflow-x-auto rounded-lg border border-gray-100 bg-gray-50/80">
      <table className="w-full min-w-[320px] border-collapse text-left text-xs text-gray-800">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-100/90">
            {header.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-1.5 font-semibold text-gray-700">
                <span dangerouslySetInnerHTML={{ __html: boldifyStatic(h) }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, ri) => (
            <tr key={ri} className="border-b border-gray-100 last:border-0 hover:bg-white/80">
              {cells.map((cell, ci) => (
                <td key={ci} className="max-w-[200px] px-2 py-1.5 align-top text-gray-700 sm:max-w-[280px]">
                  <span className="break-words" dangerouslySetInnerHTML={{ __html: boldifyStatic(cell) }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function boldifyStatic(s: string) {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: string[] = [];
  /** Accumulated pipe-table rows (including header); separator row kept for TableView to strip */
  let tableRows: string[][] | null = null;

  function flushTable() {
    if (tableRows && tableRows.length > 0) {
      elements.push(<TableView key={`tbl-${elements.length}`} rows={tableRows} />);
      tableRows = null;
    }
  }

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={elements.length} className="my-1.5 space-y-0.5 pl-4">
          {listItems.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5 text-sm">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
              <span dangerouslySetInnerHTML={{ __html: boldifyStatic(item) }} />
            </li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const pipeRow = parsePipeTableRow(line);

    if (pipeRow && pipeRow.length > 0) {
      flushList();
      if (tableRows === null) tableRows = [];
      tableRows.push(pipeRow);
      continue;
    }

    flushTable();

    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      inList = true;
      listItems.push(trimmed.slice(2));
    } else if (trimmed.match(/^\d+\.\s/)) {
      inList = true;
      listItems.push(trimmed.replace(/^\d+\.\s/, ""));
    } else {
      flushList();
      if (trimmed === "") {
        elements.push(<div key={elements.length} className="h-2" />);
      } else if (trimmed.startsWith("## ")) {
        elements.push(
          <p key={elements.length} className="mt-3 first:mt-0 font-semibold text-[13px] uppercase tracking-wide text-gray-800"
            dangerouslySetInnerHTML={{ __html: boldifyStatic(trimmed.slice(3)) }} />
        );
      } else {
        elements.push(
          <p key={elements.length} className="text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: boldifyStatic(trimmed) }} />
        );
      }
    }
  }
  flushList();
  flushTable();
  return elements;
}

// ── main component ─────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { can, loading: planLoading } = usePlan();
  const [token,        setToken]        = useState<string | null>(null);
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [input,        setInput]        = useState("");
  const [streaming,    setStreaming]     = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [dataMonth,    setDataMonth]     = useState<string | null>(null);
  const [sessionId,    setSessionId]    = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);
  const tokenRef   = useRef<string | null>(null);

  // Auth
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tok = await user.getIdToken();
        setToken(tok);
        tokenRef.current = tok;
      }
    });
  }, []);

  // Load sessions list and data month once token is available
  useEffect(() => {
    if (!token) return;
    setSessionLoading(true);
    Promise.all([
      fetch("/api/user/chat-sessions", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .catch(() => ({ sessions: [] })),
      fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .catch(() => ({})),
    ]).then(([sessionJson, consolidatedJson]) => {
      if (consolidatedJson.yearMonth) setDataMonth(consolidatedJson.yearMonth);
      const sessions: SessionSummary[] = sessionJson.sessions ?? [];
      setRecentSessions(sessions);
      setSessionLoading(false);
    }).catch(() => setSessionLoading(false));
  }, [token]);

  // Load a specific past session when user clicks it in the history list
  async function loadSession(summary: SessionSummary) {
    if (!token) return;
    setSessionLoading(true);
    try {
      const res = await fetch(`/api/user/chat-sessions/${summary.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const msgs = json.session?.messages ?? [];
      setSessionId(summary.id);
      setMessages(
        (msgs as { role: "user" | "assistant"; content: string }[]).map((m) => ({
          id: crypto.randomUUID(),
          role: m.role,
          content: m.content,
          streaming: false,
        }))
      );
      setError(null);
    } catch { /* best-effort */ }
    finally { setSessionLoading(false); }
  }

  // Save current messages to the session (fire-and-forget)
  async function persistSession(
    finalMessages: { role: "user" | "assistant"; content: string }[],
    currentSessionId: string | null,
  ): Promise<string> {
    const tok = tokenRef.current;
    if (!tok || finalMessages.length === 0) return currentSessionId ?? "";
    let sid = currentSessionId;
    if (!sid) {
      const res = await fetch("/api/user/chat-sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json().catch(() => ({}));
      sid = json.id ?? null;
      if (sid) setSessionId(sid);
    }
    if (!sid) return "";
    await fetch(`/api/user/chat-sessions/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ messages: finalMessages }),
    }).catch(() => {});
    return sid;
  }

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  }

  async function sendMessage(text: string) {
    if (!text.trim() || streaming || !token) return;
    setError(null);

    // Snapshot of existing messages before this exchange
    const prevMessages = messages;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text.trim() };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      const history = prevMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/user/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text.trim(), history }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: accumulated } : m)
        );
      }
      // Mark done
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
      );

      // Persist the completed exchange to Firestore
      const toSave = [
        ...prevMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text.trim() },
        { role: "assistant" as const, content: accumulated },
      ];
      void persistSession(toSave, sessionId);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    setSessionId(null);
    // Refresh session list so history reflects the session we just left
    if (token) {
      fetch("/api/user/chat-sessions", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((j) => setRecentSessions(j.sessions ?? []))
        .catch(() => {});
    }
  }

  if (planLoading || sessionLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
      </div>
    );
  }

  if (!can("aiChat")) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <UpgradePrompt
          feature="aiChat"
          description="Ask questions about your money in plain English. Every answer is grounded in your actual financial data — not generic advice."
        />
      </div>
    );
  }

  const isEmpty = messages.length === 0;

  return (
    <div
      className={
        // Below lg: AccountLayout stacks us under the mobile top bar (h-14). Full dvh here
        // overflows the viewport and hides the composer — subtract that bar height.
        "flex min-h-0 h-[calc(100dvh-3.5rem)] max-h-[calc(100dvh-3.5rem)] flex-col overflow-hidden " +
        "lg:h-screen lg:max-h-screen"
      }
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 leading-none">AI Financial Chat</h1>
            <p className="text-[11px] text-gray-400 mt-0.5 leading-none">Answers grounded in your real data</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {dataMonth && (
            <div className="hidden items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 px-2.5 py-1 sm:flex">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] text-gray-500">Using {dataMonth} data</span>
            </div>
          )}
          {sessionId && !isEmpty && (
            <div className="hidden items-center gap-1 sm:flex">
              <div className="h-1.5 w-1.5 rounded-full bg-purple-300" />
              <span className="text-[11px] text-gray-400">Saved</span>
            </div>
          )}
          <button
            onClick={newChat}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            New Chat
          </button>
        </div>
      </div>

      {/* Scrolls internally so the composer stays on-screen on mobile (flex-1 needs min-h-0) */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
        {isEmpty ? (
          /* Empty state — history + suggested prompts */
          <div className="mx-auto w-full max-w-xl px-4 py-10">
            {/* Hero */}
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 mb-3">
                <svg className="h-7 w-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Ask anything about your finances</h2>
              <p className="mt-1 text-sm text-gray-400 max-w-sm">
                Every answer uses your actual statements and account data — not generic advice.
              </p>
            </div>

            {/* Recent conversations */}
            {recentSessions.length > 0 && (
              <div className="mb-7">
                <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Recent conversations</p>
                <div className="space-y-1.5">
                  {recentSessions.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => loadSession(s)}
                      className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 text-left shadow-sm hover:border-purple-200 hover:bg-purple-50/30 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span className="truncate text-sm text-gray-700">{s.title}</span>
                      </div>
                      <span className="ml-3 shrink-0 text-[11px] text-gray-400">{relativeTime(s.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested prompts — horizontal scroll on small screens to save vertical space */}
            <div className="-mx-4 lg:mx-0">
              <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-gray-400 lg:px-0">
                {recentSessions.length > 0 ? "Or try a prompt" : "Try asking"}
              </p>
              <div
                className={
                  "flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 lg:px-0 " +
                  "[scrollbar-color:rgba(0,0,0,0.2)_transparent] [scrollbar-width:thin] " +
                  "lg:flex-wrap lg:overflow-x-visible lg:pb-0 lg:snap-none"
                }
              >
                {SUGGESTED.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    onClick={() => sendMessage(s.text)}
                    disabled={!token}
                    className={
                      "snap-start shrink-0 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-left " +
                      "text-xs font-medium text-gray-800 shadow-sm transition " +
                      "hover:border-purple-200 hover:bg-purple-50/50 hover:text-purple-800 " +
                      "disabled:opacity-50 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-sm"
                    }
                  >
                    <span className="mr-1 hidden sm:inline">{s.icon}</span>
                    <span className="whitespace-nowrap">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  msg.role === "user"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-500"
                }`}>
                  {msg.role === "user" ? "Y" : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  )}
                </div>

                {/* Bubble */}
                <div className={`max-w-[82%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-purple-600 text-white rounded-tr-sm"
                    : "bg-white border border-gray-100 text-gray-700 shadow-sm rounded-tl-sm"
                }`}>
                  {msg.role === "user" ? (
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  ) : msg.content ? (
                    <div className="space-y-0.5 text-gray-700">{renderContent(msg.content)}</div>
                  ) : (
                    /* Streaming dots */
                    <div className="flex items-center gap-1 py-1">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="h-1.5 w-1.5 rounded-full bg-gray-300 animate-bounce"
                          style={{ animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </div>
                  )}
                  {msg.streaming && msg.content && (
                    <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-purple-400 align-middle" />
                  )}
                </div>
              </div>
            ))}
            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer — high contrast so it doesn’t get lost above a busy page */}
      <div
        className={
          "relative z-10 shrink-0 border-t-2 border-purple-100 " +
          "bg-gradient-to-b from-white via-purple-50/50 to-purple-50 " +
          "shadow-[0_-10px_44px_-8px_rgba(88,28,135,0.14)] " +
          "px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
        }
      >
        <div className="mx-auto max-w-2xl">
          <div
            className={`rounded-2xl border-2 bg-white p-1 shadow-md transition sm:p-1.5 ${
              streaming
                ? "border-purple-400 shadow-purple-500/25 ring-2 ring-purple-200/80"
                : "border-purple-300 shadow-purple-900/10 " +
                  "focus-within:border-purple-500 focus-within:shadow-lg focus-within:shadow-purple-500/20 " +
                  "focus-within:ring-2 focus-within:ring-purple-200/90"
            }`}
          >
            <div className={`flex items-end gap-2 rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 ${streaming ? "bg-purple-50/50" : "bg-white"}`}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={streaming ? "Waiting for response…" : "Ask about your finances…"}
              disabled={streaming || !token}
              aria-label={streaming ? "Waiting for AI response" : "Ask about your finances"}
              className="flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
              style={{ minHeight: "24px", maxHeight: "160px" }}
            />
            <button
              type="button"
              onClick={() => streaming ? abortRef.current?.abort() : sendMessage(input)}
              disabled={!token || (!streaming && !input.trim())}
              className={`flex shrink-0 items-center justify-center rounded-xl text-sm transition ${
                streaming
                  ? "h-8 w-8 bg-red-100 text-red-600 shadow-sm hover:bg-red-200"
                  : [
                      "h-8 w-8 font-semibold text-white",
                      "bg-gradient-to-b from-purple-500 to-purple-700 shadow-md shadow-purple-600/50",
                      "ring-2 ring-purple-400/60 ring-offset-0 hover:from-purple-600 hover:to-purple-800 hover:shadow-lg hover:shadow-purple-600/55",
                      "active:scale-[0.97] disabled:cursor-not-allowed disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500",
                      "disabled:shadow-none disabled:ring-0 disabled:hover:from-gray-200 disabled:hover:to-gray-300",
                    ].join(" ")
              }`}
              aria-label={streaming ? "Stop" : "Send"}
            >
              {streaming ? (
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-purple-900/40">
            Analysis only — not regulated financial advice · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
