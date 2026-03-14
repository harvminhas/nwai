const features = [
  { name: "No bank login", networth: true, mint: false, ynab: true, rocket: false },
  { name: "Instant results", networth: true, mint: false, ynab: false, rocket: false },
  { name: "Transaction analysis", networth: true, mint: true, ynab: false, rocket: false },
  { name: "Subscription detection", networth: true, mint: false, ynab: false, rocket: true },
  { name: "Free tier", networth: true, mint: true, ynab: false, rocket: true },
];

function Check() {
  return <span className="text-lg text-green-600">✅</span>;
}
function Cross() {
  return <span className="text-gray-300 text-lg">❌</span>;
}

export default function ComparisonTable() {
  return (
    <section className="bg-gray-50 py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-semibold text-xl text-gray-900 md:text-2xl">
          Compare with other tools
        </h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse rounded-lg border border-gray-200 bg-white shadow">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-900">Feature</th>
                <th className="px-4 py-3 text-center font-semibold text-purple-600">networth.online</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Mint / Empower</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">YNAB</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Rocket Money</th>
              </tr>
            </thead>
            <tbody>
              {features.map((row) => (
                <tr key={row.name} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-gray-700">{row.name}</td>
                  <td className="px-4 py-3 text-center">{row.networth ? <Check /> : <Cross />}</td>
                  <td className="px-4 py-3 text-center">{row.mint ? <Check /> : <Cross />}</td>
                  <td className="px-4 py-3 text-center">{row.ynab ? <Check /> : <Cross />}</td>
                  <td className="px-4 py-3 text-center">{row.rocket ? <Check /> : <Cross />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
