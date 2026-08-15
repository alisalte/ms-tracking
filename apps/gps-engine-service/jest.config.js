/** Jest config for @fleetvision/gps-engine-service. */
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // The Sprint D E2E suite drives real Kafka/Socket.IO/pg clients inside jest's
  // experimental-vm-modules worker; their module graph keeps the worker alive
  // after teardown even though every handle is closed in afterAll (verified
  // with --detectOpenHandles: the in-band run exits cleanly). forceExit keeps
  // `pnpm test` deterministic without weakening the assertions.
  forceExit: true,
  // Real sockets/brokers need generous timeouts (graceful skips still apply).
  testTimeout: 30_000,
};
