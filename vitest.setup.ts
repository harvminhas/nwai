/**
 * Vitest global setup for jsdom tests
 * Mocks browser APIs used by Recharts
 */

// Mock ResizeObserver for Recharts ResponsiveContainer
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
