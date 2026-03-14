// Stub module for @aws-amplify/backend used in tests
export type ClientSchema<T> = Record<string, unknown>;
export const a = {
  schema: () => ({}),
  enum: () => ({}),
  model: () => ({
    authorization: () => ({}),
  }),
  string: () => ({ required: () => ({}) }),
  integer: () => ({ required: () => ({}) }),
  date: () => ({ required: () => ({}) }),
  ref: () => ({ required: () => ({}) }),
};
export function defineData(_config: unknown) {
  return {};
}
