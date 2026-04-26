export default {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "__tests__", // root directory for Jest
  // Integration tests hit mainnet via GraphQL / Pyth — give them headroom.
  testTimeout: 60000,
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: false, // Do not treat files as ESM
        tsconfig: "tsconfig.cjs.json", // Path to your TypeScript config for CJS
      },
    ],
  },
};
