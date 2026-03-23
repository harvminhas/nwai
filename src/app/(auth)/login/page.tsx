import AuthForm from "@/components/AuthForm";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <AuthForm mode="login" />
      <Link href="/" className="mt-6 text-sm text-gray-400 hover:text-gray-600">
        Back to home
      </Link>
    </div>
  );
}
