export const getPurchaseRecord = /* GraphQL */ `
  query GetPurchaseRecord($id: ID!) {
    getPurchaseRecord(id: $id) {
      id
      owner
      sakeName
      storeName
      price
      quantity
      purchaseDate
      category
      memo
      imageKey
      imageKeys
      drinkingStatus
      openedAt
      createdAt
      updatedAt
    }
  }
`;

export const listPurchaseRecords = /* GraphQL */ `
  query ListPurchaseRecords($limit: Int, $nextToken: String) {
    listPurchaseRecords(limit: $limit, nextToken: $nextToken) {
      items {
        id
        owner
        sakeName
        storeName
        price
        quantity
        purchaseDate
        category
        memo
        imageKey
        imageKeys
        drinkingStatus
        openedAt
        createdAt
        updatedAt
      }
      nextToken
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
      imageKey
      imageKeys
      createdAt
      updatedAt
    }
  }
`;

export const listDrinkingRecords = /* GraphQL */ `
  query ListDrinkingRecords($limit: Int, $nextToken: String) {
    listDrinkingRecords(limit: $limit, nextToken: $nextToken) {
      items {
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
        imageKey
        imageKeys
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;

export const getDownloadUrl = /* GraphQL */ `
  query GetDownloadUrl($key: String!) {
    getDownloadUrl(key: $key)
  }
`;
