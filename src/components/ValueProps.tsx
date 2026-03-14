const items = [
  {
    icon: "💰",
    title: "Net Worth",
    description: "See your balance instantly",
  },
  {
    icon: "📊",
    title: "Income & Expenses",
    description: "Automatic categorization",
  },
  {
    icon: "🔄",
    title: "Subscriptions",
    description: "Find all recurring charges",
  },
  {
    icon: "📈",
    title: "Savings Rate",
    description: "Track your progress",
  },
  {
    icon: "💡",
    title: "Smart Insights",
    description: "Personalized money tips",
  },
  {
    icon: "🔒",
    title: "Privacy First",
    description: "No bank login, your data stays private",
  },
];

export default function ValueProps() {
  return (
    <section className="bg-white py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center font-semibold text-xl text-gray-900 md:text-2xl">
          Everything you need to understand your finances
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-gray-100 bg-gray-50/50 p-6 text-center transition hover:shadow-md"
            >
              <span className="text-4xl" role="img" aria-hidden>
                {item.icon}
              </span>
              <h3 className="mt-3 font-semibold text-gray-900">{item.title}</h3>
              <p className="mt-1 text-base text-gray-600">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
