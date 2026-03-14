import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-gray-50 py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">
          <div>
            <h1 className="font-bold text-3xl text-gray-900 md:text-5xl md:leading-tight">
              Your Complete Financial Snapshot in 30 Seconds
            </h1>
            <p className="mt-4 text-base text-gray-600 md:text-lg">
              Upload your bank statement and instantly see your net worth, income
              breakdown, expenses, subscriptions, and smart insights—no bank login
              required.
            </p>
            <div className="mt-8">
              <Link
                href="/upload"
                className="inline-block rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-8 py-4 font-semibold text-white shadow-md transition hover:from-purple-700 hover:to-purple-800 hover:shadow-lg"
              >
                Upload Your Statement
              </Link>
            </div>
          </div>
          <div className="relative flex justify-center">
            <div className="relative h-64 w-full max-w-lg overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl md:h-80">
              {/* Dashboard preview placeholder - replace with dashboard-preview.png when available */}
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-purple-50 to-white p-8">
                <div className="text-center">
                  <p className="text-5xl font-bold text-gray-400">$12,450</p>
                  <p className="mt-2 text-sm text-gray-500">Net Worth Preview</p>
                </div>
              </div>
              {/* Uncomment when dashboard-preview.png exists:
              <Image
                src="/dashboard-preview.png"
                alt="Dashboard preview"
                fill
                className="object-contain"
                priority
              />
              */}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
