/**
 * Feature Flags — central configuration for optional features.
 * 
 * Use this to hide/show entire page sections without deleting code.
 * Routes remain reachable when flags are off; they just redirect to dashboard.
 */

export interface FeatureFlags {
  /** Show extended pages: Today, Financial Health, Forecast, Trackers, Payoff, Goals, Scenarios, Activity, Sharing */
  showExtendedPages: boolean;
}

/**
 * Get current feature flags.
 * Defaults to false (MVP-only mode) — change to true to enable all features.
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    showExtendedPages: false, // Set to true to show all pages
  };
}

/**
 * Check if a specific feature is enabled.
 */
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return getFeatureFlags()[feature];
}
