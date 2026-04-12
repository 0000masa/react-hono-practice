# Secrets Manager 運用ガイド

このドキュメントでは、AWS Secrets Manager の管理方針、削除時の注意点、RDS Proxy との連携、自動ローテーションの仕組みと Terraform 実装について解説する。

---

## 1. 管理方針: Terraform 管理 vs 手動管理

### このプロジェクトの方針: Terraform 管理

このプロジェクトでは Secrets Manager のシークレットを **Terraform で管理**している。`terraform apply` でシークレットの作成・ローテーション Lambda のデプロイ・ローテーション設定まで一括で行う。

### Terraform 管理のメリット

- `terraform apply` 一発でシークレット作成・ローテーション設定まで完了する
- prod 環境を作るとき同じコードで再現できる
- 手動作業の手順が不要

### Terraform 管理のデメリット

- `terraform destroy` 後に再作成する場合、強制削除コマンドが必要になることがある（後述）
- Terraform state ファイルにパスワードが記録される（S3 + 暗号化で緩和可能）

### 手動管理にする場合（参考）

実務では手動管理（手動でシークレットを作成し、Terraform からは `data` source で参照のみ）を採用するケースもある。

**手動管理のメリット:**
- `terraform destroy` してもシークレットが残る
- Terraform state にパスワードが記録されない
- インフラと認証情報のライフサイクルを分離できる

**手動管理のデメリット:**
- 環境ごとに以下の手動作業が必要になる：
  1. Secrets Manager のシークレットを自動ローテーション無しで手動作成
  2. `terraform apply` でインフラを構築（VPC、RDS、セキュリティグループ等）
  3. SAR のページからローテーション関数を手動作成
  4. Secrets Manager のコンソールから自動ローテーションを手動で設定
- 手順が多く、ミスが発生しやすい

手動管理に切り替える場合の Terraform コード変更：

1. `secrets_manager.tf` のリソースをコメントアウト
2. `data.tf` に data source を追加:
   ```hcl
   data "aws_secretsmanager_secret" "rds_credentials" {
     name = "${var.project_name}/rds-credentials"
   }
   ```
3. 参照箇所を `data.aws_secretsmanager_secret.rds_credentials.arn` に変更（`rds_proxy.tf`, `iam_policy.tf`）

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

まず、AWS CLI の動作確認と削除予定のシークレットの確認を行う：

```bash
aws secretsmanager list-secrets --include-planned-deletion --region ap-northeast-1
```

出力は JSON 形式で表示される。結果が長い場合、AWS CLI が自動的に `less` ページャーを起動する（画面下部に `(END)` と表示される）。**`q` キー**を押すとページャーが終了してターミナルに戻る。

ページャーを使わずに直接出力したい場合は `--no-cli-pager` オプションを付ける：

```bash
aws secretsmanager list-secrets --include-planned-deletion --region ap-northeast-1 --no-cli-pager
```

永続的にページャーを無効化する場合：

```bash
aws configure set cli_pager ""
```

出力結果に `DeletedDate` フィールドがあるシークレットが削除予定状態のもの。

削除予定のシークレットが確認できたら、`terraform apply` の前に強制削除する：

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

これが「RDS Proxy の認証情報を Secrets Manager で管理する」設計の利点の一つ。RDS に直接接続する構成だとアプリ側の接続設定も変更が必要になるが、RDS Proxy + Secrets Manager の組み合わせなら全自動で回る。

---

## 4. 自動ローテーション

### 概要

Secrets Manager の自動ローテーションを有効にすると、指定したスケジュールで DB パスワードを自動的に更新する。ローテーションの実体は Lambda 関数で、AWS が公式テンプレートを提供しているため自分でコードを書く必要はない。

### ローテーションの処理フロー

```
Secrets Manager（スケジュール: 30日ごと）
      │
      │ Lambda を呼び出す
      ▼
ローテーション Lambda（プライベートサブネット内）
      │
      │ 1. Secrets Manager API で新しいパスワードを生成
      │ 2. RDS に接続して ALTER USER でパスワードを変更
      │ 3. Secrets Manager のシークレット値を新しいパスワードに更新
      ▼
RDS Proxy
      │
      │ 次回の DB 接続時に Secrets Manager から最新のパスワードを自動取得
      ▼
正常動作を継続（アプリ側の変更不要）
```

### ローテーション関数とは

ローテーション関数は、パスワードの生成・RDS への適用・Secrets Manager への保存を行う Lambda 関数。AWS が Serverless Application Repository（SAR）で MySQL / PostgreSQL などのエンジン別にテンプレートを公開している。

MySQL 用のテンプレート名: `SecretsManagerRDSMySQLRotationSingleUser`

このテンプレートは「SingleUser」方式で、1 つの DB ユーザーのパスワードを直接変更する。別に「MultiUser」方式もあり、2 つの DB ユーザーを交互に使ってダウンタイムゼロでローテーションするが、構成が複雑になる。

### ローテーション関数のネットワーク要件

ローテーション Lambda はプライベートサブネットに配置され、以下の 2 つにアクセスする必要がある：

```
ローテーション Lambda（プライベートサブネット内）
      │
      ├──→ RDS（パスワード変更）       ← RDS SG で Port 3306 を許可
      │
      └──→ Secrets Manager API        ← NAT Gateway or VPC エンドポイント経由
```

- **RDS へのアクセス**: ローテーション Lambda 用のセキュリティグループから RDS SG への Port 3306 ingress を許可する
- **Secrets Manager API へのアクセス**: NAT Gateway があれば到達可能。NAT Gateway がない環境では Secrets Manager 用の VPC エンドポイントが必要

---

## 5. Terraform 実装の詳細

### 5.1 シークレットの作成（secrets_manager.tf）

```hcl
resource "aws_secretsmanager_secret" "rds_credentials" {
  name        = "${var.project_name}/rds-credentials"
  description = "RDS credentials for RDS Proxy"
}

resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id     = aws_secretsmanager_secret.rds_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = data.aws_ssm_parameter.db_password.value
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
```

`lifecycle { ignore_changes = [secret_string] }` が重要。これがないと、ローテーションで更新されたパスワードを `terraform apply` のたびに SSM の初期値で上書きしてしまう。初回作成時のみ SSM の値で設定し、以降はローテーション Lambda が管理する。

### 5.2 ローテーション Lambda の作成（lambda.tf）

```hcl
resource "aws_serverlessapplicationrepository_cloudformation_stack" "rotation_lambda" {
  name           = "${var.project_name}-rds-rotation"
  application_id = "arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSMySQLRotationSingleUser"

  capabilities = ["CAPABILITY_IAM", "CAPABILITY_RESOURCE_POLICY"]

  parameters = {
    endpoint            = "https://secretsmanager.${data.aws_region.current.name}.amazonaws.com"
    functionName        = "${var.project_name}-rds-rotation"
    vpcSubnetIds        = join(",", [local.private_subnet_a_id, local.private_subnet_c_id])
    vpcSecurityGroupIds = aws_security_group.rotation_lambda_sg.id
  }
}
```

`aws_serverlessapplicationrepository_cloudformation_stack` は SAR のテンプレートを CloudFormation スタックとしてデプロイするリソース。SAR テンプレートの中身は Lambda 関数 + 必要な IAM パーミッションの CloudFormation テンプレート。

**application_id の `297356227824` について:** これは自分の AWS アカウント ID ではなく、AWS が SAR テンプレートを公開している固定のアカウント ID。全 AWS ユーザー共通のため、ハードコードが正しい。

**semantic_version について:** SAR テンプレートのバージョンを指定する。古いバージョン（例: `1.1.225`）は Python 3.7 ランタイムを使用しており、AWS Lambda でサポート終了済みのため `terraform apply` 時に以下のエラーが発生する：

```
The runtime parameter of python3.7 is no longer supported for creating
or updating AWS Lambda functions.
```

Python 3.11 以降に対応したバージョン（例: `1.1.434`）を指定する必要がある。最新バージョンは [SAR の SecretsManagerRDSMySQLRotationSingleUser ページ](https://serverlessrepo.aws.amazon.com/applications/us-east-1/297356227824/SecretsManagerRDSMySQLRotationSingleUser) で確認できる。

また、古いバージョンで `terraform apply` に失敗すると CloudFormation スタックが `ROLLBACK_COMPLETE` 状態で残ることがある。バージョンを修正して再度 `terraform apply` してもこの残骸が邪魔になる場合は、手動で削除する：

```bash
aws cloudformation delete-stack \
  --stack-name serverlessrepo-{project_name}-rds-rotation \
  --region ap-northeast-1
```

**parameters の説明:**

| パラメータ | 説明 |
|---|---|
| `endpoint` | ローテーション Lambda が Secrets Manager API を呼ぶためのエンドポイント URL |
| `functionName` | 作成される Lambda 関数の名前 |
| `vpcSubnetIds` | Lambda を配置するプライベートサブネット（RDS にアクセスするため VPC 内に配置） |
| `vpcSecurityGroupIds` | Lambda に割り当てるセキュリティグループ |

### 5.3 ローテーション設定（secrets_manager.tf）

```hcl
resource "aws_secretsmanager_secret_rotation" "rds_credentials" {
  secret_id           = aws_secretsmanager_secret.rds_credentials.id
  rotation_lambda_arn = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-rds-rotation"

  rotation_rules {
    automatically_after_days = 30
  }
}
```

`rotation_lambda_arn` は SAR でデプロイされるローテーション Lambda の ARN。SAR スタックのリソースからは直接 ARN を取得しにくいため、命名規則から ARN を構築している。

### 5.4 セキュリティグループ（security_groups.tf）

ローテーション Lambda 用のセキュリティグループを作成し、RDS SG にその Lambda からの ingress を許可する。

```hcl
# ローテーション Lambda 用 SG
resource "aws_security_group" "rotation_lambda_sg" {
  name   = "${var.project_name}-rotation-lambda-sg"
  vpc_id = module.vpc.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]  # NAT Gateway 経由で Secrets Manager API にアクセス
  }
}

# RDS SG に追加する ingress ルール
resource "aws_security_group" "rds_sg" {
  # ... 既存の RDS Proxy からの ingress に加えて ...
  ingress {
    description     = "MySQL from Secrets Manager rotation Lambda"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.rotation_lambda_sg.id]
  }
}
```

### 5.5 IAM ポリシー（iam_policy.tf）

ローテーション Lambda がシークレットの読み書きとパスワード生成を行うための権限。

```hcl
resource "aws_iam_policy" "rotation_lambda_policy" {
  name = "${var.project_name}-rotation-lambda-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage"
        ]
        Resource = aws_secretsmanager_secret.rds_credentials.arn
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetRandomPassword"
        Resource = "*"
      }
    ]
  })
}
```

**各アクションの用途:**

| アクション | 用途 |
|---|---|
| `DescribeSecret` | シークレットのメタデータ（ローテーション状態等）を確認 |
| `GetSecretValue` | 現在のパスワードを取得（RDS 接続時に使用） |
| `PutSecretValue` | 新しいパスワードをシークレットに書き込む |
| `UpdateSecretVersionStage` | 新しいパスワードを「現在のバージョン」に昇格させる |
| `GetRandomPassword` | 暗号学的に安全なランダムパスワードを生成（対象リソースを限定できないため `*`） |

### 5.6 Lambda パーミッション（lambda.tf）

Secrets Manager がローテーション Lambda を呼び出すためのリソースベースポリシー。

```hcl
resource "aws_lambda_permission" "secrets_manager_rotation" {
  function_name = "${var.project_name}-rds-rotation"
  action        = "lambda:InvokeFunction"
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.rds_credentials.arn
}
```

---

## 6. ローテーションのスケジュール設定

### Terraform での設定

```hcl
rotation_rules {
  automatically_after_days = 30
}
```

### コンソールから設定する場合

2 つの方式から選べる：

| | スケジュールビルダー | スケジュール式 |
|---|---|---|
| 設定方法 | GUI でプルダウンから選ぶ | cron/rate 式を直接書く |
| 例 | 「30日ごと」を選択 | `rate(30 days)` |
| 柔軟性 | 基本的な間隔のみ | 細かい指定が可能 |

どちらも内部的には同じ cron/rate 式に変換されるため、動作に違いはない。

### 推奨頻度

| 環境 | 推奨頻度 | 理由 |
|---|---|---|
| 一般的な本番 | 30 日 | AWS のデフォルト推奨値。セキュリティと運用負荷のバランスが良い |
| 高セキュリティ要件 | 7〜14 日 | 金融・医療など規制が厳しい業界 |
| 練習・開発 | 設定しない or 90 日 | コスト削減 |

---

## 7. Secret type の選択について

コンソールでシークレットを手動作成する場合、Secret type を選択する画面がある。

### 「Other type of secret」 vs 「Credentials for Amazon RDS database」

どちらを選んでも中身の JSON 形式（`{"username":"...","password":"..."}`）は同じで、RDS Proxy の動作に違いはない。

「Credentials for Amazon RDS database」を選ぶと特定の RDS インスタンスとの紐付けを求められるが、今回の構成では RDS Proxy が Secrets Manager からシークレットを読み取るだけなので紐付けは不要。RDS インスタンスがまだ存在しない段階では選択できない場合もあるため、「Other type of secret」の方がシンプル。

---

## 8. 関連ファイル一覧

| ファイル | 役割 |
|---|---|
| `terraform/modules/app-infrastructure/secrets_manager.tf` | シークレットの作成 + ローテーション設定 |
| `terraform/modules/app-infrastructure/lambda.tf` | ローテーション Lambda（SAR テンプレート）のデプロイ + Secrets Manager からの呼び出し許可 |
| `terraform/modules/app-infrastructure/iam_role.tf` | ローテーション Lambda 用 IAM ロール |
| `terraform/modules/app-infrastructure/iam_policy.tf` | ローテーション Lambda 用ポリシー + RDS Proxy 用シークレット読み取りポリシー |
| `terraform/modules/app-infrastructure/security_groups.tf` | ローテーション Lambda 用 SG + RDS SG への ingress 追加 |
| `terraform/modules/app-infrastructure/rds_proxy.tf` | RDS Proxy の auth 設定でシークレット ARN を参照 |
| `terraform/modules/app-infrastructure/data.tf` | SSM Parameter Store から DB パスワードを取得（シークレットの初期値用） |
