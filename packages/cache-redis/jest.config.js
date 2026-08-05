/** Jest config for @fleetvision/cache-redis. */
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.spec.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Tests construct real ioredis clients (against dead ports) to assert error
  // handling; the driver's reconnect timer lingers past test completion.
  forceExit: true,
};
