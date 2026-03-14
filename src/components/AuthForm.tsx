"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

type Mode = "login" | "signup";

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { auth } = getFirebaseClient();
      if (isSignup) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.push("/account/dashboard");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { auth } = getFirebaseClient();
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.push("/account/dashboard");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Something went wrong";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-md">
      <h1 className="font-bold text-2xl text-gray-900">
        {isSignup ? "Create account" : "Log in"}
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        {isSignup
          ? "Sign up to save your statements and track over time."
          : "Welcome back."}
      </p>

      <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800 disabled:opacity-50"
        >
          {loading ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>

      <div className="mt-4 flex items-center gap-4">
        <span className="flex-1 border-t border-gray-200" />
        <span className="text-sm text-gray-500">or</span>
        <span className="flex-1 border-t border-gray-200" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gray-300 py-3 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        <span>Sign in with Google</span>
      </button>

      <p className="mt-6 text-center text-sm text-gray-600">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <a href="/account/login" className="font-medium text-purple-600 hover:underline">
              Log in
            </a>
          </>
        ) : (
          <>
            Don&apos;t have an account?{" "}
            <a href="/account/signup" className="font-medium text-purple-600 hover:underline">
              Sign up
            </a>
          </>
        )}
      </p>
    </div>
  );
}
