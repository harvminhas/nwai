import Link from "next/link";
import LandingHeader from "@/components/LandingHeader";

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export default function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-white">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          <p className="mt-2 text-sm text-gray-400">Last updated: {lastUpdated}</p>
        </div>

        <div className="
          [&>p]:text-gray-600 [&>p]:leading-relaxed [&>p]:my-4 [&>p]:text-[15px]
          [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:text-gray-900 [&>h2]:mt-10 [&>h2]:mb-3
          [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-gray-800 [&>h3]:mt-6 [&>h3]:mb-2
          [&>ul]:my-3 [&>ul]:space-y-1.5 [&>ul]:pl-5 [&>ul]:list-disc
          [&>ul>li]:text-[15px] [&>ul>li]:text-gray-600 [&>ul>li]:leading-relaxed
          [&>ol]:my-3 [&>ol]:space-y-1.5 [&>ol]:pl-5 [&>ol]:list-decimal
          [&>ol>li]:text-[15px] [&>ol>li]:text-gray-600 [&>ol>li]:leading-relaxed
          [&_strong]:font-semibold [&_strong]:text-gray-800
          [&_a]:text-purple-600 [&_a:hover]:underline
        ">
          {children}
        </div>

        {/* Footer links */}
        <div className="mt-16 border-t border-gray-100 pt-8 flex flex-wrap gap-4 text-sm text-gray-400">
          <Link href="/terms" className="hover:text-gray-600 transition">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-gray-600 transition">Privacy Policy</Link>
          <Link href="/" className="hover:text-gray-600 transition">← Back to home</Link>
        </div>
      </main>
    </div>
  );
}
