/**
 * Vitest global setup.
 *
 * Runs before each test file. Extends expect with jest-dom matchers, and
 * enables mock mode by default so component tests see deterministic demo data
 * (the backend isn't running during tests). Tests that exercise the real-first
 * default override this via localStorage manipulation.
 */
import '@testing-library/jest-dom/vitest';

// Enable mock mode for all tests (the backend isn't available in the test env).
if (typeof window !== 'undefined') {
  window.localStorage.setItem('fleetvision_use_mock', 'true');
}
