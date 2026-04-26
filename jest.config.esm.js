export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  rootDir: "__tests__", // root directory for Jest
  extensionsToTreatAsEsm: [".ts"], // Treat TypeScript files as ESM
  // Integration tests hit mainnet via GraphQL / Pyth — give them headroom.
  testTimeout: 60000,
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true, // ts-jest ESM support
        tsconfig: "tsconfig.esm.json", // Path to your TypeScript config for ESM
      },
    ],
  },
};
