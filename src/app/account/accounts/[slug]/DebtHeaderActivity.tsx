/**
 * Debt-account variant of the account-detail header In/Out block.
 * Non-debt accounts keep the original In/Out markup on the page.
 */

export const DEBT_HEADER_ACTIVITY_WRAP_CLASS =
  "ml-auto flex flex-wrap justify-end gap-x-6 gap-y-2 text-right max-lg:w-full lg:shrink-0";

export const DEBT_HEADER_ACTIVITY_ITEM_CLASS = "shrink-0";

export const DEBT_HEADER_ACTIVITY_LABEL_CLASS =
  "text-[10px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap";

type Props = {
  monthAbbrev: string;
  paid: { amount: number; count: number } | null;
  newCharges: { amount: number; count: number } | null;
  formatAmount: (n: number) => string;
};

export default function DebtHeaderActivity({
  monthAbbrev,
  paid,
  newCharges,
  formatAmount,
}: Props) {
  if (!paid && !newCharges) return null;

  const monthSuffix = monthAbbrev ? ` \u00b7 ${monthAbbrev}` : "";

  return (
    <div className={DEBT_HEADER_ACTIVITY_WRAP_CLASS}>
      {paid && (
        <div className={DEBT_HEADER_ACTIVITY_ITEM_CLASS}>
          <p className={DEBT_HEADER_ACTIVITY_LABEL_CLASS}>Paid{monthSuffix}</p>
          <p className="mt-0.5 text-sm font-bold text-green-600 tabular-nums">{formatAmount(paid.amount)}</p>
          {paid.count > 0 && (
            <p className="text-[10px] text-gray-400">{paid.count} transactions</p>
          )}
        </div>
      )}
      {newCharges && (
        <div className={DEBT_HEADER_ACTIVITY_ITEM_CLASS}>
          <p className={DEBT_HEADER_ACTIVITY_LABEL_CLASS}>New charges{monthSuffix}</p>
          <p className="mt-0.5 text-sm font-bold text-red-500 tabular-nums">{formatAmount(newCharges.amount)}</p>
          {newCharges.count > 0 && (
            <p className="text-[10px] text-gray-400">{newCharges.count} transactions</p>
          )}
        </div>
      )}
    </div>
  );
}
