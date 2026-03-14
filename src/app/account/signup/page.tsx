import Link from "next/link";
import AuthForm from "@/components/AuthForm";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <AuthForm mode="signup" />
      <Link href="/" className="mt-8 text-sm text-gray-500 hover:underline">
        Back to home
      </Link>
    </div>
  );
}
