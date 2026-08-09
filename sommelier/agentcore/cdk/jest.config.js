module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
  // 実設定の synth は CodeZip の梱包（uv による依存解決）を伴う。
  // キャッシュが温まっていない環境では既定の5秒では確実に足りない
  testTimeout: 120000,
};
