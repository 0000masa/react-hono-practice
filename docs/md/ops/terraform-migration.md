# Terraform 構成変更: ECS/ALB → API Gateway + Lambda + RDS Proxy

## 概要

バックエンドのインフラ構成を **ALB + ECS Fargate** から **API Gateway REST API + Lambda + RDS Proxy** に移行する。
フロントエンド（S3 + CloudFront）と RDS（MariaDB 11.4）はそのまま維持する。

## 移行の動機

- ECS Fargate の常時稼働コスト（Web + Queue Worker で月 ~$40）を削減
- Lambda のサーバーレス化により、リクエストベースの従量課金に切り替え
- 運用の簡素化（ECS タスク定義、ECR イメージ管理、Blue/Green デプロイ等が不要に）

## アーキテクチャ比較

### 移行前

```
CloudFront → ALB → ECS Fargate (nginx + backend + fluent-bit + otel)
                         ↓
                        RDS (MariaDB 11.4)
                         
ECS Worker (SQS 長ポーリング) → RDS
EventBridge → ECS RunTask (マイグレーション / 日次レポート)
```

### 移行後

```
CloudFront (WAF) → API Gateway REST API (API キー認証) → Lambda (API)
                                                              ↓
                                                          RDS Proxy (IAM認証)
                                                              ↓
                                                          RDS (MariaDB 11.4)

SQS → Lambda (SQS Worker)  → RDS Proxy → RDS
EventBridge → Lambda (日次レポート) → RDS Proxy → RDS
GitHub Actions → Lambda (マイグレーション) → RDS Proxy → RDS
```

## RDS Proxy と認証パターン

### なぜ RDS Proxy が必要か

Lambda は呼び出しごとに新しい実行環境が起動する可能性がある。直接 RDS に接続すると、同時接続数がスパイクして `Too many connections` エラーが発生する。RDS Proxy はコネクションプールを管理し、Lambda のスケーリングに伴う接続数の急増を吸収する。

### RDS Proxy が解決するのは「接続の効率化」

RDS Proxy は DB の同時接続数を増やすのではなく、**接続の使い方を効率化（多重化 / multiplexing）**する。

**Proxy なしの場合:**

```
Lambda が100個同時起動 → 100本の DB 接続が張られる
各 Lambda の実行中、SQL を実行していない待ち時間でも接続を占有し続ける
→ RDS の max_connections（例: 150）をすぐに使い切る
```

**Proxy ありの場合:**

```
Lambda が100個同時起動 → Proxy が100本のクライアント接続を受ける
Proxy は内部で少数の DB 接続を使い回す（多重化）
ある Lambda が SQL を実行していない間、その DB 接続を別の Lambda に割り当てる
→ クライアント100本に対して実際の DB 接続は数十本で済む
```

つまり「クライアント接続数 > 実際の DB 接続数」を実現することで、RDS の `max_connections` の範囲内でより多くの Lambda を捌ける。極端に大量のリクエストが来た場合は、最終的には RDS 側の接続上限がボトルネックになる。

### 認証パターン

Lambda → RDS Proxy → RDS の接続方法には2つのパターンがある。

| | パターン1 | パターン2 |
|---|---|---|
| Lambda → Proxy | IAM 認証 | IAM 認証 |
| Proxy → RDS | Secrets Manager（パスワード） | IAM データベース認証 |
| MariaDB 対応 | **対応** | **非対応** |

**本プロジェクトではパターン1を採用。**

理由:
- **MariaDB 11.4 は IAM データベース認証をサポートしていない**（MySQL と PostgreSQL のみ対応）。そのためパターン2は技術的に不可能。
- パターン1 は AWS が推奨する標準的なパターンであり、ドキュメントも豊富。

### パターン1 の認証フロー

```
1. Lambda が AWS SDK の Signer で IAM 認証トークンを生成
2. Lambda がトークンをパスワードとして RDS Proxy に TLS 接続
3. RDS Proxy が IAM を使って Lambda のロールを検証
4. RDS Proxy が Secrets Manager から DB パスワードを取得
5. RDS Proxy が通常のパスワード認証で RDS に接続
```

## Terraform ファイル構成（移行後）

```
terraform/modules/app-infrastructure/
├── acm.tf                 # SSL証明書（フロントエンドのみ）
├── api_gateway.tf         # 【新規】REST API、API キー、使用量プラン
├── cloudfront.tf          # 【修正】バックエンドオリジンを API Gateway に変更
├── cloudwatch.tf          # 【修正】Lambda 用ロググループ + アラーム
├── data.tf                # 【修正】ECR 参照を削除
├── event_bridge.tf        # 【修正】ターゲットを Lambda に変更
├── iam.tf                 # 【修正】Lambda 実行ロール + ポリシー
├── lambda.tf              # 【新規】API / SQS Worker / Migration / DailyReport
├── lambda-notification.tf # エラー通知 Lambda（変更なし）
├── providers.tf           # 【修正】random プロバイダー追加（API キー生成用）
├── rds.tf                 # RDS インスタンス（変更なし）
├── rds_proxy.tf           # 【新規】RDS Proxy + IAM ロール
├── route53.tf             # 【修正】バックエンドレコード削除（API Gateway はデフォルトドメインを使用）
├── s3.tf                  # S3 バケット（変更なし）
├── secrets_manager.tf     # 【新規】RDS 認証情報
├── security_groups.tf     # 【修正】Lambda SG / RDS Proxy SG
├── ses.tf                 # SES 設定（変更なし）
├── sns.tf                 # SNS 通知トピック（変更なし）
├── sqs.tf                 # SQS キュー（変更なし）
├── ssm.tf                 # 【修正】Lambda 関数名パラメータ追加
├── variables.tf           # 【修正】image_tag 削除
├── vpc.tf                 # VPC 設定（変更なし）
└── waf.tf                 # 【修正】cf_secret 削除

削除されたファイル:
├── alb.tf                 # ALB + ターゲットグループ + リスナー
├── ecs_web.tf             # ECS クラスタ + Web サービス + タスク定義
├── ecs_queue.tf           # ECS キューワーカーサービス
└── ecs_tasks.tf           # ECS ワンオフタスク（マイグレーション等）
```

## Lambda 関数一覧

| 関数名 | ハンドラー | メモリ | タイムアウト | トリガー | 用途 |
|--------|-----------|--------|------------|---------|------|
| `{project}-api` | `lambda.handler` | 1024 MB | 29秒 | API Gateway | Hono API サーバー |
| `{project}-sqs-worker` | `sqs-handler.handler` | 1024 MB | 60秒 | SQS | QR コード非同期生成 |
| `{project}-migration` | `migrate.handler` | 512 MB | 15分 | 手動実行 | DB マイグレーション |
| `{project}-daily-report` | `daily-report.handler` | 512 MB | 5分 | EventBridge | 日次レポートバッチ |
| `{project}-notifications-email` | `lambda_function.lambda_handler` | 128 MB | 30秒 | CloudWatch Logs | エラー通知メール |

## セキュリティグループ構成

```
Lambda SG
  ├─ Ingress: なし（Lambda は呼び出されるため不要）
  └─ Egress: 全トラフィック（NAT Gateway 経由で外部アクセス）

RDS Proxy SG
  ├─ Ingress: 3306/TCP from Lambda SG
  └─ Egress: 全トラフィック

RDS SG
  ├─ Ingress: 3306/TCP from RDS Proxy SG
  └─ Egress: なし
```

## リクエストフロー

```
ユーザー
  ↓ HTTPS
CloudFront (WAF 保護)
  ├─ /api/* → API Gateway REST API (x-api-key ヘッダーで認証)
  │              ↓ API キーが無い or 不正 → 403 (Lambda に到達しない)
  │              ↓ API キーが有効
  │          Lambda (Hono API)
  │              ↓ IAM 認証 + TLS
  │          RDS Proxy
  │              ↓ Secrets Manager パスワード
  │          RDS (MariaDB)
  │
  └─ その他 → S3 (SPA fallback → /index.html)

直接アクセス（CloudFront を経由しない）
  ↓ HTTPS
API Gateway REST API → 403 Forbidden（API キー無し）
  ※ Lambda は起動しない = コスト発生しない
```

## バックエンド側の変更

Terraform の変更だけでは完結しない。バックエンドのアプリケーションコードにも以下の変更が必要。

### 1. エントリーポイントの設計

Hono アプリ本体（`src/app.ts`）はデプロイ先に依存しない。エントリーポイントをデプロイ先ごとに分離することで、Lambda 以外（Cloudflare Workers 等）にも対応できる構成にしている。

```
src/
├── app.ts       # Hono アプリ本体（共通、デプロイ先に依存しない）
├── index.ts     # Node.js 用エントリーポイント（ローカル開発）
└── lambda.ts    # AWS Lambda 用エントリーポイント
```

`src/lambda.ts`:

```typescript
import { handle } from 'hono/aws-lambda';
import { initDatabase } from './config/database';
import app from './app';

const dbReady = initDatabase();
const lambdaHandler = handle(app);

export const handler = async (event: any, context: any) => {
  await dbReady;
  return lambdaHandler(event, context);
};
```

### 2. ビルドスクリプト

デプロイ先ごとにビルドスクリプトを分離:

```json
{
  "build": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --packages=external",
  "build:lambda": "esbuild src/lambda.ts --bundle --platform=node --outfile=dist/lambda.js --target=node20 --external:@aws-sdk/*"
}
```

`@aws-sdk/*` は Lambda ランタイムに含まれるため、バンドルから除外してパッケージサイズを削減する。

### 3. RDS Proxy IAM 認証対応

`DATABASE_USE_IAM_AUTH` 環境変数で開発環境と本番環境の DB 接続を切り替える:

| | 開発環境 | 本番環境 (Lambda) |
|---|---|---|
| `DATABASE_USE_IAM_AUTH` | 未設定 (`false`) | `true` |
| 接続先 | ローカル MySQL (Docker) | RDS Proxy |
| 認証 | パスワード（同期的に初期化） | IAM トークン（非同期で初期化） |
| コネクション数 | 10 | 1（RDS Proxy がプールを管理） |
| SSL | 不要 | 必須（`ssl: { rejectUnauthorized: true }`） |

`src/config/database.ts` で `DATABASE_USE_IAM_AUTH` が `false`（開発環境）の場合はモジュール読み込み時に同期的にプールを作成する。`true`（本番）の場合は `initDatabase()` で `@aws-sdk/rds-signer` を動的インポートして IAM トークンを生成する。

```typescript
// 開発環境: db はモジュール読み込み時に初期化済み → そのまま使える
// 本番環境: Lambda エントリーポイントが initDatabase() を呼んでから使う
import { db } from '../config/database';
```

ESM の live binding により、`initDatabase()` で `db` が代入された後は各モジュールから最新の値が参照されるため、既存の import をそのまま使える。

### 4. SQS ワーカーハンドラーの作成（TODO）

`backend/src/sqs-handler.ts` で SQS イベントを受け取り QR コード生成処理を実行。

### 5. マイグレーション / 日次レポートハンドラーの作成（TODO）

それぞれ `backend/src/migrate.ts`、`backend/src/daily-report.ts` を作成。

## デプロイ方式

Terraform は初回のインフラ構築のみ担当。Lambda 関数のコードデプロイは GitHub Actions で行う。

```
Terraform:
  - Lambda 関数をダミー ZIP で作成
  - lifecycle { ignore_changes = [filename, source_code_hash] }

GitHub Actions:
  1. npm run build:lambda
  2. zip -j lambda.zip dist/lambda.js
  3. aws lambda update-function-code --function-name {name} --zip-filefile://lambda.zip
```

SSM Parameter Store に各 Lambda 関数名を保存しているため、GitHub Actions から参照可能。

## コスト比較（概算）

| 項目 | 移行前（月額） | 移行後（月額） |
|------|-------------|-------------|
| ALB | ~$16 | $0 |
| ECS Fargate (Web) | ~$30 | $0 |
| ECS Fargate (Worker) | ~$8 | $0 |
| Lambda (10万リクエスト/月) | $0 | ~$0.42 |
| API Gateway REST API | $0 | ~$0.35 |
| RDS Proxy | $0 | ~$5.40 |
| Secrets Manager | $0 | ~$0.40 |
| **合計** | **~$54** | **~$6.57** |

NAT Gateway (~$32/月) は両方とも共通のため比較から除外。

## API Gateway: HTTP API vs REST API

API Gateway には **HTTP API** と **REST API** の2種類がある。本プロジェクトでは **REST API** を採用した。

### 比較

| | HTTP API | REST API |
|---|---|---|
| Terraform リソース | `aws_apigatewayv2_api` | `aws_api_gateway_rest_api` |
| 料金（100万リクエストあたり） | $1.00 | $3.50 |
| レイテンシ | 低い | 比較的高い |
| Lambda プロキシ統合 | 対応 | 対応 |
| リクエスト/レスポンス変換 | 非対応 | 対応 |
| API キー・使用量プラン | **非対応** | **対応** |
| リソースポリシー | **非対応** | **対応** |
| キャッシュ機能 | 非対応 | 対応 |

### REST API を選んだ理由

コストだけを見れば HTTP API（$1.00/100万リクエスト）の方が安い。しかし本構成では **CloudFront の WAF を迂回させない**ことが重要であり、REST API を選択した。

#### CloudFront 経由を強制する必要性

API Gateway にはデフォルトドメイン（`{id}.execute-api.{region}.amazonaws.com`）が付与される。CloudFront に WAF（レート制限等）を設定していても、攻撃者がこのドメインに直接アクセスすれば WAF を完全にバイパスできてしまう。

#### HTTP API の場合の問題

HTTP API にはリソースポリシーや API キー機能がないため、CloudFront 経由かどうかを **API Gateway レベルで判定できない**。アプリケーション（Lambda）側のミドルウェアで検証するしかないが、この場合：

1. 不正リクエストでも **Lambda が起動する** → コスト発生
2. 大量リクエストで **Lambda の同時実行数を消費** → 正規リクエストにも影響
3. CloudFront WAF のレート制限が **完全に無意味**になる

#### REST API の解決策

REST API の **API キー機能**を使うことで、API Gateway レベルで不正リクエストを拒否できる：

1. CloudFront がオリジンリクエストに `x-api-key` ヘッダー（シークレット値）を付与
2. REST API の全メソッドに `api_key_required = true` を設定
3. API キーが無い/不正なリクエスト → **403 Forbidden**（Lambda に到達しない）

```
CloudFront 経由:  CloudFront → x-api-key付与 → API Gateway → 認証OK → Lambda
直接アクセス:     攻撃者 → API Gateway → API キー無し → 403 (Lambdaは起動しない)
```

料金差（月10万リクエストで約$0.25）と引き換えに、WAF のセキュリティを確実に機能させる構成となる。

## 注意事項

1. **タイムアウト**: API Gateway + Lambda は最大30秒。長時間かかる API がないか確認が必要
2. **コールドスタート**: VPC Lambda + Node.js は通常1-3秒。必要なら Provisioned Concurrency を検討
3. **レスポンスサイズ**: Lambda のレスポンスは最大6MB（ストリーミングで20MB）
4. **セッション Cookie**: CloudFront 経由のパスベースルーティング（`/api/*`）のため、Cookie は問題なく動作
5. **NAT Gateway**: Lambda VPC から外部サービス（Google OAuth、SES 等）へのアクセスに引き続き必要
