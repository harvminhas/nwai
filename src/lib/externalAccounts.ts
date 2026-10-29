/**
 * External Account Labels
 * 
 * Tracks transfers to accounts outside the app for fraud detection and reconciliation.
 */

export interface ExternalAccountLabel {
  /** Last 4 digits of the account number */
  accountNumber: string;
  /** User-provided label (e.g., "Wife's line of credit") */
  label: string;
  /** When this label was created */
  createdAt: string;
  /** When last updated */
  updatedAt: string;
  /** Typical transfer amount to this account (for anomaly detection) */
  typicalAmount?: number;
  /** Number of transfers seen to this account */
  transferCount: number;
  /** Whether this destination has been confirmed by the user */
  confirmed: boolean;
}

export interface FlaggedTransfer {
  /** Transaction date */
  date: string;
  /** Amount */
  amount: number;
  /** Source account label */
  fromAccount: string;
  /** Source account slug */
  fromAccountSlug: string;
  /** Destination account number (last 4 digits) */
  destinationNumber: string;
  /** Merchant/description */
  merchant: string;
  /** Month this occurred */
  month: string;
  /** Why this is flagged */
  reason: "new_destination" | "unusual_amount";
  /** If unusual_amount, what's the typical amount */
  typicalAmount?: number;
  /** Whether this is an anomalous amount (computed: >3x typical) */
  isAnomalous?: boolean;
}
