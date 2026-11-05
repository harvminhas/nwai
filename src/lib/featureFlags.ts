/**
 * Feature flags for temporary product gates.
 * 
 * Use these to disable features cleanly without deleting code.
 */

export const FEATURE_FLAGS = {
  /**
   * CSV import is temporarily disabled while transaction identity design is finalized.
   * 
   * When disabled:
   * - CSV import UI is hidden in the account detail page
   * - /api/user/csv-import returns a clear disabled response
   * - PDF statement parsing and all other import flows remain unchanged
   * 
   * To re-enable: set this to true and redeploy.
   */
  CSV_IMPORT_ENABLED: false,
} as const;
