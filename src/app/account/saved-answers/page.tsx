"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { AiAnswer } from "@/components/AiAnswer";

interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

// Note: AI answer rendering moved to shared AiAnswer component

export default function SavedAnswersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [savedAnswers, setSavedAnswers] = useState<SavedAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const tok = await user.getIdToken();
      setToken(tok);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    loadSavedAnswers();
  }, [token]);

  const loadSavedAnswers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/user/saved-answers", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSavedAnswers(data.savedAnswers || []);
      }
    } catch (error) {
      console.error("Failed to load saved answers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!token || deleting) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/user/saved-answers", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setSavedAnswers((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete saved answer:", error);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white pb-12">
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Saved Answers</h1>
          <p className="text-gray-600">
            Answers you've bookmarked from the AI assistant
          </p>
        </div>

        {savedAnswers.length === 0 ? (
          <div className="rounded-2xl border-2 border-gray-200 bg-white p-12 text-center">
            <div className="mb-4 text-5xl">📚</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">No saved answers yet</h3>
            <p className="text-gray-600">
              Bookmark helpful answers from the Ask box or Chat to save them here
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {savedAnswers.map((answer) => (
              <div
                key={answer.id}
                className="rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {answer.question}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(answer.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(answer.id)}
                    disabled={deleting === answer.id}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                    aria-label="Delete"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
                <div className="prose prose-sm max-w-none">
                  <AiAnswer content={answer.answer} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
