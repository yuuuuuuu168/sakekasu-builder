export const getPurchaseRecord = /* GraphQL */ `
  query GetPurchaseRecord($id: ID!) {
    getPurchaseRecord(id: $id) {
      id
      owner
      sakeName
      storeName
      price
      purchaseDate
      category
      memo
      createdAt
      updatedAt
    }
  }
`;

export const listPurchaseRecords = /* GraphQL */ `
  query ListPurchaseRecords {
    listPurchaseRecords {
      id
      owner
      sakeName
      storeName
      price
      purchaseDate
      category
      memo
      createdAt
      updatedAt
    }
  }
`;

export const getDrinkingRecord = /* GraphQL */ `
  query GetDrinkingRecord($id: ID!) {
    getDrinkingRecord(id: $id) {
      id
      owner
      sakeName
      placeName
      price
      drinkingDate
      category
      drinkingMethod
      rating
      memo
      createdAt
      updatedAt
    }
  }
`;

export const listDrinkingRecords = /* GraphQL */ `
  query ListDrinkingRecords {
    listDrinkingRecords {
      id
      owner
      sakeName
      placeName
      price
      drinkingDate
      category
      drinkingMethod
      rating
      memo
      createdAt
      updatedAt
    }
  }
`;
