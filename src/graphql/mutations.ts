export const createPurchaseRecord = /* GraphQL */ `
  mutation CreatePurchaseRecord($input: CreatePurchaseRecordInput!) {
    createPurchaseRecord(input: $input) {
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

export const updatePurchaseRecord = /* GraphQL */ `
  mutation UpdatePurchaseRecord($input: UpdatePurchaseRecordInput!) {
    updatePurchaseRecord(input: $input) {
      id
      owner
      sakeName
      storeName
      price
      quantity
      purchaseDate
      category
      memo
      drinkingStatus
      openedAt
      createdAt
      updatedAt
    }
  }
`;

export const deletePurchaseRecord = /* GraphQL */ `
  mutation DeletePurchaseRecord($id: ID!) {
    deletePurchaseRecord(id: $id) {
      id
    }
  }
`;

export const markPurchaseOpened = /* GraphQL */ `
  mutation MarkPurchaseOpened($id: ID!) {
    markPurchaseOpened(id: $id) {
      id
      drinkingStatus
      openedAt
    }
  }
`;

export const createDrinkingRecord = /* GraphQL */ `
  mutation CreateDrinkingRecord($input: CreateDrinkingRecordInput!) {
    createDrinkingRecord(input: $input) {
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

export const updateDrinkingRecord = /* GraphQL */ `
  mutation UpdateDrinkingRecord($input: UpdateDrinkingRecordInput!) {
    updateDrinkingRecord(input: $input) {
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

export const deleteDrinkingRecord = /* GraphQL */ `
  mutation DeleteDrinkingRecord($id: ID!) {
    deleteDrinkingRecord(id: $id) {
      id
    }
  }
`;

export const generateUploadUrl = /* GraphQL */ `
  mutation GenerateUploadUrl(
    $recordType: String!
    $recordId: String!
    $contentType: String!
    $fileName: String!
  ) {
    generateUploadUrl(
      recordType: $recordType
      recordId: $recordId
      contentType: $contentType
      fileName: $fileName
    ) {
      uploadUrl
      key
    }
  }
`;

export const analyzeSakeLabel = /* GraphQL */ `
  mutation AnalyzeSakeLabel($imageKey: String!) {
    analyzeSakeLabel(imageKey: $imageKey) {
      sakeName
      confidence
      rawTexts
    }
  }
`;
