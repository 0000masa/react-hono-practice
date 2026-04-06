# Secrets Manager 運用ガイド

このドキュメントでは、AWS Secrets Manager の管理方針、削除時の注意点、RDS Proxy との連携、自動ローテーションについて解説する。

---

## 1. 管理方針: Terraform 管理 vs 手動管理

### このプロジェクトの方針: Terraform 管理

このプロジェクトでは Secrets Manager のシークレットを **Terraform で管理**している。`terraform apply` でシークレットの作成・ローテーション設定まで一括で行う。

```hcl
# secrets_manager.tf
resource "aws_secretsmanager_secret" "rds_credentials" {
  name = "${var.project_name}/rds-credentials"
}

resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id     = aws_secretsmanager_secret.rds_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = data.aws_ssm_parameter.db_password.value
  })
}
```

### Terraform 管理のメリット

- `terraform apply` 一発でシークレット作成・ローテーション設定まで完了する
- prod 環境を作るとき同じコードで再現できる
- 手動作業の手順が不要

### Terraform 管理のデメリット

- `terraform destroy` 後に再作成する場合、強制削除コマンドが必要になることがある（後述）
- Terraform state ファイルにパスワードが記録される（S3 + 暗号化で緩和可能）

### 手動管理にする場合のメリット・デメリット

実務では手動管理（手動でシークレットを作成し、Terraform からは `data` source で参照のみ）を採用するケースもある。

**手動管理のメリット:**
- `terraform destroy` してもシークレットが残る
- Terraform state にパスワードが記録されない
- インフラと認証情報のライフサイクルを分離できる

**手動管理のデメリット:**
- 環境ごとに手動でシークレットを作成する必要がある
- ローテーション関数の設定も手動で行う必要がある（VPC 作成後にコンソールから設定）
- 手順が多く、ミスが発生しやすい

### 手動管理の場合の手順（参考）

手動管理にする場合、以下の 4 ステップが必要になる：

1. Secrets Manager のシークレットを自動ローテーション無しで手動作成
2. `terraform apply` でインフラを構築（VPC、RDS、セキュリティグループ等）
3. Serverless Application Repository（SAR）のページからローテーション関数を手動作成
4. Secrets Manager のコンソールから自動ローテーションを手動で設定

Terraform 管理なら `terraform apply` だけでこれらが全て完了する。

### 手動管理にする場合の Terraform コード変更

手動管理に切り替える場合は以下の変更が必要：

1. `secrets_manager.tf` のリソースをコメントアウト
2. `data.tf` に data source を追加:
   ```hcl
   data "aws_secretsmanager_secret" "rds_credentials" {
     name = "${var.project_name}/rds-credentials"
   }
   ```
3. 参照箇所を `data.aws_secretsmanager_secret.rds_credentials.arn` に変更
   - `rds_proxy.tf` の `secret_arn`
   - `iam_policy.tf` の `Resource`

---

## 2. 削除予定状態のシークレット

### Terraform 管理時に起きる問題

Secrets Manager はシークレットを削除すると、即座には消えず**30 日間の復旧猶予期間（削除予定状態）**に入る。この期間中は同名のシークレットを作成できない。

Terraform 管理下で `terraform destroy` → `terraform apply` すると以下のエラーが発生する：

```
Error: creating Secrets Manager Secret (kum-stg/rds-credentials):
InvalidRequestException: You can't create this secret because a secret
with this name is already scheduled for deletion.
```

### 対処法: 強制削除コマンド

`terraform apply` の前に、削除予定のシークレットを強制削除する：

```bash
aws secretsmanager delete-secret \
  --secret-id "<シークレット名またはARN>" \
  --force-delete-without-recovery \
  --region ap-northeast-1
```

- `--force-delete-without-recovery`: 復旧猶予期間をスキップして即座に完全削除する
- 実行後、`terraform apply` で同名のシークレットを再作成できるようになる

### コンソールで削除予定のシークレットを確認する方法

削除予定のシークレットは AWS コンソールのデフォルト表示では**表示されない**。確認するには、Secrets Manager の画面で「**Preferences（設定）**」から「**Show secrets scheduled for deletion（削除予定のシークレットを表示）**」を有効にする。

### 削除予定状態のまとめ

- シークレットは使用できない
- AWS コンソールのデフォルト表示には表示されない
- 同名のシークレットを新規作成できない
- デフォルトで 7〜30 日後に完全削除される
- `--force-delete-without-recovery` で即座に完全削除可能

---

## 3. RDS Proxy との連携

### 認証フロー

```
Lambda
  │ IAM 認証トークン
  ▼
RDS Proxy
  │ Secrets Manager から username/password を取得
  ▼
RDS（MySQL）
```

- Lambda → RDS Proxy: IAM 認証（`iam_auth = "REQUIRED"`）
- RDS Proxy → RDS: Secrets Manager の認証情報（`auth_scheme = "SECRETS"`）

### Terraform コード

**rds_proxy.tf** — RDS Proxy がシークレットから DB 認証情報を取得するための設定：

```hcl
auth {
  iam_auth    = "REQUIRED"
  auth_scheme = "SECRETS"
  secret_arn  = aws_secretsmanager_secret.rds_credentials.arn
}
```

**iam_policy.tf** — RDS Proxy がシークレットを読み取るための IAM ポリシー：

```hcl
Action = [
  "secretsmanager:GetSecretValue",
  "secretsmanager:DescribeSecret"
]
Resource = aws_secretsmanager_secret.rds_credentials.arn
```

### RDS Proxy はローテーション後も自動で新しい認証情報を取得する

RDS Proxy の `auth` ブロックで `auth_scheme = "SECRETS"` + `secret_arn` が設定されていれば、シークレットの更新（ローテーション含む）を自動検知して新しい認証情報を取得する。RDS Proxy 側で追加設定は不要。

```
ローテーション発生時:
  1. ローテーション Lambda が RDS のパスワードを新しい値に変更
  2. ローテーション Lambda が Secrets Manager 内のシークレット値も更新
  3. RDS Proxy は次回の DB 接続時に Secrets Manager から最新の値を自動取得
```

これが「RDS Proxy の認証情報を Secrets Manager で管理する」設計の利点の一つ。RDS に直接接続する構成だとアプリ側の接続設定も変更が必要になるが、RDS Proxy + Secrets Manager の組み合わせなら全自動で回る。

---

## 4. 自動ローテーション

### 概要

Secrets Manager の自動ローテーションを有効にすると、指定したスケジュールで DB パスワードを自動的に更新する。ローテーションの実体は Lambda 関数で、AWS が公式テンプレート（ブループリント）を提供している。

### ローテーション関数とは

ローテーション関数は、パスワードの生成・RDS への適用・Secrets Manager への保存を行う Lambda 関数。自分でコードを書く必要はなく、AWS が MySQL / PostgreSQL などのエンジン別にテンプレートを用意している。

MySQL 用のテンプレート名: `SecretsManagerRDSMySQLRotationSingleUser`

### ローテーション関数の作成方法

ローテーション関数は以下の方法で作成できる：

**方法 1: Secrets Manager のコンソールから作成**

1. Secrets Manager → シークレットを開く → 「Edit rotation」
2. 「Automatic rotation」を ON にする
3. 「作成機能」をクリック → Serverless Application Repository（SAR）のページが別タブで開く
4. SAR のページでテンプレートを選択し、VPC 設定を指定してデプロイ

**方法 2: Terraform で作成（このプロジェクトの方針）**

Terraform でローテーション関数の作成・設定を一括管理できる。

### ローテーション関数のネットワーク要件

ローテーション Lambda はプライベートサブネットに配置され、以下の 2 つにアクセスする必要がある：

```
ローテーション Lambda（プライベートサブネット内）
      │
      ├──→ RDS（パスワード変更）       ← RDS SG で Port 3306 を許可
      │
      └──→ Secrets Manager API        ← NAT Gateway or VPC エンドポイント経由
```

- **RDS へのアクセス**: セキュリティグループで Port 3306 を許可する必要がある
- **Secrets Manager API へのアクセス**: NAT Gateway があれば到達可能。NAT Gateway がない環境では Secrets Manager 用の VPC エンドポイントが必要

### スケジュールの設定方法

コンソールで 2 つの方式から選べる：

| | スケジュールビルダー | スケジュール式 |
|---|---|---|
| 設定方法 | GUI でプルダウンから選ぶ | cron/rate 式を直接書く |
| 例 | 「30日ごと」を選択 | `rate(30 days)` |
| 柔軟性 | 基本的な間隔のみ | 細かい指定が可能 |
| 向いている人 | cron 式に慣れていない場合 | 実行タイミングを細かく制御したい場合 |

どちらも内部的には同じ cron/rate 式に変換されるため、動作に違いはない。

### 推奨頻度

| 環境 | 推奨頻度 | 理由 |
|---|---|---|
| 一般的な本番 | 30 日 | AWS のデフォルト推奨値。セキュリティと運用負荷のバランスが良い |
| 高セキュリティ要件 | 7〜14 日 | 金融・医療など規制が厳しい業界 |
| 練習・開発 | 設定しない or 90 日 | コスト削減 |

---

## 5. Secret type の選択について

コンソールでシークレットを手動作成する場合、Secret type を選択する画面がある。

### 「Other type of secret」 vs 「Credentials for Amazon RDS database」

どちらを選んでも中身の JSON 形式（`{"username":"...","password":"..."}`）は同じで、RDS Proxy の動作に違いはない。

「Credentials for Amazon RDS database」を選ぶと特定の RDS インスタンスとの紐付けを求められるが、今回の構成では RDS Proxy が Secrets Manager からシークレットを読み取るだけなので紐付けは不要。RDS インスタンスがまだ存在しない段階では選択できない場合もあるため、「Other type of secret」の方がシンプル。

---

## 6. 関連ファイル一覧

| ファイル | 役割 |
|---|---|
| `terraform/modules/app-infrastructure/secrets_manager.tf` | シークレットのリソース定義（Terraform 管理） |
| `terraform/modules/app-infrastructure/rds_proxy.tf` | RDS Proxy の auth 設定でシークレット ARN を参照 |
| `terraform/modules/app-infrastructure/iam_policy.tf` | RDS Proxy がシークレットを読み取る IAM ポリシー |
| `terraform/modules/app-infrastructure/data.tf` | SSM Parameter Store から DB パスワードを取得（シークレットの初期値用） |
