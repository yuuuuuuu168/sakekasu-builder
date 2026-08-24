export const createPurchaseRecord = /* GraphQL */ `
  mutation CreatePurchaseRecord($input: CreatePurchaseRecordInput!) {
    createPurchaseRecord(input: $input) {
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
      brewery
      region
      alcoholPercentage
      volumeMl
      specificName
      ricePolishingRatio
      sakeMeterValue
      acidity
      aminoAcidity
      riceVariety
      yeast
      labelDescription
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
      remainingQuantity
      purchaseDate
      category
      memo
      brewery
      region
      alcoholPercentage
      volumeMl
      specificName
      ricePolishingRatio
      sakeMeterValue
      acidity
      aminoAcidity
      riceVariety
      yeast
      labelDescription
      imageKey
      imageKeys
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
      brewery
      region
      alcoholPercentage
      volumeMl
      specificName
      ricePolishingRatio
      sakeMeterValue
      acidity
      aminoAcidity
      riceVariety
      yeast
      labelDescription
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
      brewery
      region
      alcoholPercentage
      volumeMl
      specificName
      ricePolishingRatio
      sakeMeterValue
      acidity
      aminoAcidity
      riceVariety
      yeast
      labelDescription
      imageKey
      imageKeys
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
    $temporary: Boolean
    $thumbnail: Boolean
  ) {
    generateUploadUrl(
      recordType: $recordType
      recordId: $recordId
      contentType: $contentType
      fileName: $fileName
      temporary: $temporary
      thumbnail: $thumbnail
    ) {
      uploadUrl
      key
      # taggingHeader は要求しない。タグは署名済み URL のクエリに入っており、
      # クライアントがヘッダで送ると二重指定で 403 になる（PR #147）
    }
  }
`;

export const analyzeSakeLabel = /* GraphQL */ `
  mutation AnalyzeSakeLabel($imageKey: String!, $additionalImageKeys: [String!]) {
    analyzeSakeLabel(imageKey: $imageKey, additionalImageKeys: $additionalImageKeys) {
      sakeName
      category
      region
      alcoholPercentage
      brewery
      volumeMl
      specificName
      ricePolishingRatio
      sakeMeterValue
      acidity
      aminoAcidity
      riceVariety
      yeast
      labelDescription
      confidence
      fieldConfidence {
        sakeName
        category
        region
        alcoholPercentage
        brewery
        volumeMl
        specificName
        ricePolishingRatio
        sakeMeterValue
        acidity
        aminoAcidity
        riceVariety
        yeast
        labelDescription
      }
    }
  }
`;

export const copyImages = /* GraphQL */ `
  mutation CopyImages($sourceKeys: [String!]!, $recordType: String!, $recordId: ID!) {
    copyImages(sourceKeys: $sourceKeys, recordType: $recordType, recordId: $recordId)
  }
`;

export const generateTastingNote = /* GraphQL */ `
  mutation GenerateTastingNote($sakeName: String!, $category: SakeCategory!) {
    generateTastingNote(sakeName: $sakeName, category: $category) {
      tastingNote
      recommendedServing
    }
  }
`;
