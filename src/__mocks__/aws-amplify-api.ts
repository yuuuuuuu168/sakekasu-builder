// Stub module for aws-amplify/api used in tests
export function generateClient() {
  return {
    graphql: async () => ({ data: {} }),
  };
}
