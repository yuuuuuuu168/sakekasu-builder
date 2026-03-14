import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  SakeCategory: a.enum(['NIHONSHU', 'BEER', 'WINE', 'WHISKY', 'SHOCHU', 'OTHER']),

  PurchaseRecord: a.model({
    sakeName: a.string().required(),
    storeName: a.string().required(),
    price: a.integer().required(),
    purchaseDate: a.date().required(),
    category: a.ref('SakeCategory').required(),
    memo: a.string(),
  }).authorization(allow => [allow.publicApiKey()]),

  DrinkingRecord: a.model({
    sakeName: a.string().required(),
    placeName: a.string().required(),
    price: a.integer(),
    drinkingDate: a.date().required(),
    category: a.ref('SakeCategory').required(),
    drinkingMethod: a.string().required(),
    rating: a.integer().required(),
    memo: a.string(),
  }).authorization(allow => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
