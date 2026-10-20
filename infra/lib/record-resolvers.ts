import * as appsync from 'aws-cdk-lib/aws-appsync';
import type { Construct } from 'constructs';
import { MAX_IMAGES_PER_RECORD, TEMP_LOCATION } from './image-constants.js';

// 購入・飲酒記録の AppSync リゾルバー（APPSYNC_JS）。api-stack.ts から切り出した。
//
// リゾルバーとパイプライン関数の scope は呼び出し側のスタックのままにしている。
// Construct で包むと論理 ID が変わり、cdkd が作り直しにかかるため。

/**
 * markPurchaseOpened リゾルバーを作成する。
 *
 * 未開封（drinkingStatus が NOT_STARTED、または飲みきり機能導入前で属性なし）の
 * ときだけ「飲み中」にして開封日時を記録する。すでに開封済み・他人の記録の場合は
 * 条件式で弾き、エラーではなく null を返して呼び出し側に「変更なし」を伝える。
 * これにより再送・二重送信・端末間のズレがあっても openedAt は上書きされない。
 */
export function addMarkPurchaseOpenedResolver(purchaseDataSource: appsync.DynamoDbDataSource): void {
  purchaseDataSource.createResolver('MarkPurchaseOpenedResolver', {
    typeName: 'Mutation',
    fieldName: 'markPurchaseOpened',
    runtime: appsync.FunctionRuntime.JS_1_0_0,
    code: appsync.Code.fromInline(`
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    update: {
      expression: 'SET #drinkingStatus = :inProgress, #openedAt = :now, #updatedAt = :now',
      expressionNames: {
        '#drinkingStatus': 'drinkingStatus',
        '#openedAt': 'openedAt',
        '#updatedAt': 'updatedAt',
      },
      expressionValues: util.dynamodb.toMapValues({ ':inProgress': 'IN_PROGRESS', ':now': now }),
    },
    condition: {
      expression:
        '#owner = :expectedOwner AND (attribute_not_exists(#drinkingStatus) OR #drinkingStatus = :notStarted)',
      expressionNames: { '#owner': 'owner', '#drinkingStatus': 'drinkingStatus' },
      expressionValues: util.dynamodb.toMapValues({
        ':expectedOwner': ctx.identity.sub,
        ':notStarted': 'NOT_STARTED',
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    // 条件不成立（開封済み or 他人の記録）は「変更なし」として扱う。
    // 所有者かどうかを応答から区別できないようにする意図もある
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      return null;
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
  });
}

/**
 * 指定されたレコード型の CRUD リゾルバーを作成するヘルパー
 */
export function addRecordResolvers(
  scope: Construct,
  api: appsync.GraphqlApi,
  dataSource: appsync.DynamoDbDataSource,
  typeName: string,
  lambdaDataSource: appsync.LambdaDataSource,
): void {
  const jsRuntime = appsync.FunctionRuntime.JS_1_0_0;

  /**
   * 画像キーを検証するリゾルバーコード片（create / update で共有）。
   *
   * 他人のキーを書いた記録を作れると、その記録を削除したときに削除
   * パイプラインが他人の画像を消してしまう。作成だけでなく更新でも要る
   * （登録後に画像を足せるようにしたため。Issue #142）。
   *
   * あわせて一時領域（{sub}/tmp/...）のキーも拒否する。あちらは
   * ライフサイクルで 1 日後に消えるため、記録に持たせると実体だけが
   * 消えて画像の出ない記録が残る。フロントは保存前に正式な場所へ
   * 複製しているが、API を直接叩けばその手順を飛ばせる（Issue #140）
   */
  const imageOwnershipGuard = `
  // 添付枚数の上限。copyImages にも同じ上限があるが、あちらは複製経路だけを
  // 見ている。API を直接叩いて任意の枚数を書き込まれると、getDownloadUrls の
  // 上限（100件）を超えた記録が開けなくなり、削除時の S3 呼び出しも青天井になる
  if (input.imageKeys && input.imageKeys.length > ${MAX_IMAGES_PER_RECORD}) {
    util.error('Invalid imageKeys: too many images', 'BadRequest');
  }

  // 空配列は素通りする。中身が無いのでループの検査は 1 度も走らないまま
  // imageKeys = [] が書き込まれ、記録から画像への参照だけが消えて
  // S3 の実体が誰からも辿れなくなる。画像を外す操作は今のところ無い
  if (input.imageKeys && input.imageKeys.length === 0) {
    util.error('Invalid imageKeys: must not be empty', 'BadRequest');
  }

  const prefix = ctx.identity.sub + '/';

  // 自分のキーか。null 要素で落ちないよう、値の有無もここで見る
  const isOwned = (key) => !!key && key.startsWith(prefix);

  // 一時領域のキーはそのまま記録に入れられない
  const rejectTemporary = (key) => {
    if (key.split('/')[1] === '${TEMP_LOCATION}') {
      util.error('Invalid imageKey: temporary keys cannot be stored in records', 'BadRequest');
    }
  };

  if (input.imageKey) {
    if (!isOwned(input.imageKey)) {
      util.error('Unauthorized: imageKey must belong to the requester', 'Unauthorized');
    }
    rejectTemporary(input.imageKey);
  }
  if (input.imageKeys) {
    for (const key of input.imageKeys) {
      if (!isOwned(key)) {
        util.error('Unauthorized: imageKeys must belong to the requester', 'Unauthorized');
      }
      rejectTemporary(key);
    }
  }
`;

  // create ミューテーション
  dataSource.createResolver(`Create${typeName}Resolver`, {
    typeName: 'Mutation',
    fieldName: `create${typeName}`,
    runtime: jsRuntime,
    code: appsync.Code.fromInline(`
export function request(ctx) {
  const now = util.time.nowISO8601();
  const input = ctx.args.input;

  // 画像キーは自分のものだけを受け付ける
${imageOwnershipGuard}
  const item = {
    ...input,
    id: util.autoId(),
    owner: ctx.identity.sub,
    createdAt: now,
    updatedAt: now,
  };
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ id: item.id }),
    attributeValues: util.dynamodb.toMapValues(item),
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
  });

  // list クエリ（limit/nextToken によるページネーション対応）
  dataSource.createResolver(`List${typeName}sResolver`, {
    typeName: 'Query',
    fieldName: `list${typeName}s`,
    runtime: jsRuntime,
    code: appsync.Code.fromInline(`
export function request(ctx) {
  const req = {
    operation: 'Query',
    index: 'owner-index',
    query: {
      expression: '#owner = :owner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':owner': ctx.identity.sub }),
    },
    limit: ctx.args.limit ?? 100,
  };
  if (ctx.args.nextToken) {
    req.nextToken = ctx.args.nextToken;
  }
  return req;
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return { items: ctx.result.items, nextToken: ctx.result.nextToken };
}
`),
  });

  // get クエリ
  dataSource.createResolver(`Get${typeName}Resolver`, {
    typeName: 'Query',
    fieldName: `get${typeName}`,
    runtime: jsRuntime,
    code: appsync.Code.fromInline(`
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const result = ctx.result;
  if (!result) {
    return null;
  }
  if (result.owner !== ctx.identity.sub) {
    util.unauthorized();
  }
  return result;
}
`),
  });

  // update ミューテーション（条件式で owner 検証 + UpdateItem）
  dataSource.createResolver(`Update${typeName}Resolver`, {
    typeName: 'Mutation',
    fieldName: `update${typeName}`,
    runtime: jsRuntime,
    code: appsync.Code.fromInline(`
export function request(ctx) {
  const input = ctx.args.input;
  const now = util.time.nowISO8601();

  // 画像キーは自分のものだけを受け付ける。
  // 登録後に画像を追加できるようにしたため、更新経路でも検証する（Issue #142）
${imageOwnershipGuard}
  // input から id を除いた更新フィールドを構築
  const expParts = [];
  const expNames = {};
  const expValues = {};

  const keys = Object.keys(input);
  for (const key of keys) {
    if (key !== 'id') {
      expParts.push('#' + key + ' = :' + key);
      expNames['#' + key] = key;
      expValues[':' + key] = input[key];
    }
  }

  // updatedAt を常に更新
  expParts.push('#updatedAt = :updatedAt');
  expNames['#updatedAt'] = 'updatedAt';
  expValues[':updatedAt'] = now;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: input.id }),
    update: {
      expression: 'SET ' + expParts.join(', '),
      expressionNames: expNames,
      expressionValues: util.dynamodb.toMapValues(expValues),
    },
    condition: {
      expression: '#owner = :expectedOwner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':expectedOwner': ctx.identity.sub }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Unauthorized: owner mismatch', 'Unauthorized');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
  });

  // delete ミューテーション（Pipeline リゾルバー: DynamoDB 削除 → S3 画像削除）
  // ステップ1: DynamoDB から記録を取得（imageKey含む）して削除
  const deleteRecordFunction = new appsync.AppsyncFunction(
    scope,
    `Delete${typeName}Function`,
    {
      name: `Delete${typeName}Function`,
      api,
      dataSource: dataSource,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    condition: {
      expression: '#owner = :expectedOwner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':expectedOwner': ctx.identity.sub }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Unauthorized: owner mismatch', 'Unauthorized');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  // 削除された記録を stash に保存（imageKey を次のステップで使用）
  ctx.stash.deletedRecord = ctx.result;
  return ctx.result;
}
`),
    },
  );

  // ステップ2: imageKey が存在する場合、Lambda 経由で S3 画像削除
  const deleteImageFunction = new appsync.AppsyncFunction(
    scope,
    `DeleteImage${typeName}Function`,
    {
      name: `DeleteImage${typeName}Function`,
      api,
      dataSource: lambdaDataSource,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  const deletedRecord = ctx.stash.deletedRecord;
  const imageKey = deletedRecord && deletedRecord.imageKey ? deletedRecord.imageKey : null;
  const imageKeys = deletedRecord && deletedRecord.imageKeys ? deletedRecord.imageKeys : null;

  if (!imageKey && (!imageKeys || imageKeys.length === 0)) {
    return { operation: 'Invoke', payload: { info: { fieldName: 'deleteImage' }, arguments: {}, identity: ctx.identity } };
  }

  return { operation: 'Invoke', payload: { info: { fieldName: 'deleteImage' }, arguments: { imageKey: imageKey, imageKeys: imageKeys }, identity: ctx.identity } };
}

export function response(ctx) {
  if (ctx.error) {
    // このスタックで唯一 util.error ではなく appendError を使う場所。
    //
    // 1段目で記録は既に削除されている。ここで中断すると「削除に失敗した」と
    // 返しながら記録は存在しない状態になり、利用者が再試行しても直せない。
    // 画像の消し残しは記録の削除そのものとは別の問題なので、
    // ミューテーション自体は成功として返す。
    //
    // 握りつぶしているわけではない。Lambda 側は失敗を level=ERROR /
    // action=deleteImage のログに出しており、ImageDeleteFailCount の
    // メトリクスフィルター経由で監視スタックのアラームから Slack に届く。
    // 消し残しは運用側で拾って対処する
    util.appendError(ctx.error.message, ctx.error.type);
  }
  return ctx.stash.deletedRecord;
}
`),
    },
  );

  // Pipeline リゾルバー
  api.createResolver(`Delete${typeName}Resolver`, {
    typeName: 'Mutation',
    fieldName: `delete${typeName}`,
    runtime: jsRuntime,
    pipelineConfig: [deleteRecordFunction, deleteImageFunction],
    code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}

export function response(ctx) {
  return ctx.prev.result;
}
`),
  });
}
