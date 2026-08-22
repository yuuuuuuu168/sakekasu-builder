export const getPurchaseRecord = /* GraphQL */ `
  query GetPurchaseRecord($id: ID!) {
    getPurchaseRecord(id: $id) {
      id
      owner
      sakeName
      storeName
      price
      quantity
      remainingQuantity
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
        remainingQuantity
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
      purchaseRecordId
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
        purchaseRecordId
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;

// 画像 URL は 1 件ずつではなくまとめて取る。1 件ずつ投げると一覧で画像の数だけ
// Lambda を呼ぶことになり、同時実行枠を使い切ってスロットリングされる。
// 単体版（getDownloadUrl）はサーバー側に残してあるが、フロントからは使わない
export const getDownloadUrls = /* GraphQL */ `
  query GetDownloadUrls($keys: [String!]!) {
    getDownloadUrls(keys: $keys)
  }
`;
