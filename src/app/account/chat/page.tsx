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
// Converts **bold**, bullet lines, and line breaks without a full MD lib

function renderContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={elements.length} className="my-1.5 space-y-0.5 pl-4">
          {listItems.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5 text-sm">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
              <span dangerouslySetInnerHTML={{ __html: boldify(item) }} />
            </li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  }

  function boldify(s: string) {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  for (const line of lines) {
    const trimmed = line.trim();
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
          <p key={elements.length} className="mt-2 font-semibold text-sm text-gray-800"
            dangerouslySetInnerHTML={{ __html: boldify(trimmed.slice(3)) }} />
        );
      } else {
        elements.push(
          <p key={elements.length} className="text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: boldify(trimmed) }} />
        );
      }
    }
  }
  flushList();
  return elements;
}

// ── main component ─────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { can, setTestPlan, loading: planLoading } = usePlan();
  const [token,        setToken]        = useState<string | null>(null);
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [input,        setInput]        = useState("");
  const [streaming,    setStreaming]     = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [dataMonth,    setDataMonth]     = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  // Auth
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) setToken(await user.getIdToken());
    });
  }, []);

  // Fetch current data month for the context badge
  useEffect(() => {
    if (!token) return;
    fetch("/api/user/statements/consolidated", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((j) => { if (j.yearMonth) setDataMonth(j.yearMonth); })
      .catch(() => {});
  }, [token]);

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

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text.trim() };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
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

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
  }

  if (planLoading) {
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
    <div className="flex h-[calc(100vh-0px)] flex-col lg:h-screen">
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
          {!isEmpty && (
            <button
              onClick={clearChat}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-50 mb-4">
              <svg className="h-8 w-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Ask anything about your finances</h2>
            <p className="mt-1.5 text-sm text-gray-400 max-w-sm">
              Every answer uses your actual statements and account data — not generic advice.
            </p>

            {/* Suggested prompts */}
            <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2 w-full max-w-xl">
              {SUGGESTED.map((s) => (
                <button
                  key={s.text}
                  onClick={() => sendMessage(s.text)}
                  disabled={!token}
                  className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-white px-4 py-3 text-left text-sm text-gray-600 shadow-sm hover:border-purple-200 hover:bg-purple-50/40 hover:text-purple-800 transition disabled:opacity-50"
                >
                  <span className="text-base leading-none mt-0.5">{s.icon}</span>
                  <span>{s.text}</span>
                </button>
              ))}
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

      {/* Input bar */}
      <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <div className={`flex items-end gap-2 rounded-2xl border bg-white px-3 py-2 transition ${
            streaming ? "border-purple-200 bg-purple-50/30" : "border-gray-200 focus-within:border-purple-300 focus-within:ring-2 focus-within:ring-purple-100"
          }`}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={streaming ? "Waiting for response…" : "Ask about your finances…"}
              disabled={streaming || !token}
              className="flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
              style={{ minHeight: "24px", maxHeight: "160px" }}
            />
            <button
              onClick={() => streaming ? abortRef.current?.abort() : sendMessage(input)}
              disabled={!token || (!streaming && !input.trim())}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40 ${
                streaming
                  ? "bg-red-100 text-red-500 hover:bg-red-200"
                  : "bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-100 disabled:text-gray-400"
              }`}
            >
              {streaming ? (
                /* Stop icon */
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                /* Send icon */
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-300">
            Analysis only — not regulated financial advice · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
