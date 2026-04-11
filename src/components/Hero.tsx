import Link from "next/link";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-white py-14 md:py-20" aria-label="Hero">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">

          {/* ── Left: copy ─────────────────────────────────────────────────── */}
          <div>
            <h1 className="font-extrabold text-4xl text-gray-900 leading-tight md:text-5xl md:leading-[1.1]">
              Finally know where your<br />
              <span className="text-purple-600">money actually goes.</span>
            </h1>
            <p className="mt-5 text-base text-gray-500 md:text-lg max-w-lg">
              Upload a PDF bank statement and get your net worth, spending
              breakdown, savings rate, and AI-powered insights — in under a
              minute. Your data stays yours.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
              <Link
                href="/upload"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-7 py-3.5 font-semibold text-white shadow-md transition hover:bg-purple-700 hover:shadow-lg text-base"
              >
                Upload a statement — it&apos;s free
              </Link>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              PDF &nbsp;·&nbsp; Any Canadian bank &nbsp;·&nbsp; Under 60 seconds
            </p>
          </div>

          {/* ── Right: mock preview card ────────────────────────────────────── */}
          <div className="flex justify-center lg:justify-end">
            <div className="w-full max-w-sm rounded-xl shadow-2xl border border-gray-200 overflow-hidden bg-white">

              {/* Browser chrome */}
              <div className="bg-gray-100 px-3 py-2 flex items-center gap-2.5 border-b border-gray-200">
                <div className="flex gap-1.5 shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 bg-white rounded-md text-[11px] text-gray-400 px-3 py-0.5 text-center">
                  Today · networth.online
                </div>
              </div>

              {/* Dashboard preview */}
              <div className="p-3.5 space-y-2.5 bg-gray-50">

                {/* Net worth block */}
                <div className="bg-white rounded-lg p-3 border border-gray-100">
                  <div className="text-[9px] text-gray-400 uppercase tracking-wider font-medium">Net Worth</div>
                  <div className="text-[22px] font-bold text-gray-900 mt-0.5 leading-none">CA$1,059,066</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">Updated today &nbsp;·&nbsp; 13 accounts</div>
                  <div className="flex gap-2 mt-2">
                    <span className="bg-green-50 text-green-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">Savings&nbsp;+54%</span>
                    <span className="bg-purple-50 text-purple-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">Income $6,442</span>
                  </div>
                </div>

                {/* High priority insight */}
                <div className="bg-white rounded-lg p-2.5 border border-gray-100 flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 bg-red-100 text-red-600 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">
                    High Priority
                  </span>
                  <p className="text-[11px] text-gray-600 leading-snug">
                    Consolidate high-interest debt. CA$142 across 3 payments. Consolidating could save CA$300/mo.
                  </p>
                </div>

                {/* Worth reviewing insight */}
                <div className="bg-white rounded-lg p-2.5 border border-gray-100 flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">
                    Reviewing
                  </span>
                  <p className="text-[11px] text-gray-600 leading-snug">
                    CA$111 in fees last month. CA$1 × REGIONI.EZ MSP — may be avoidable.
                  </p>
                </div>

                {/* Upcoming */}
                <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                  <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-2">
                    Upcoming &nbsp;·&nbsp; By Impact
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-gray-500">VMLT · Salary</span>
                      <span className="text-[11px] font-semibold text-green-600">+$5,408 · Apr 17</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-gray-500">House Cleaning</span>
                      <span className="text-[11px] font-semibold text-gray-700">−$176 · In 5d</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
