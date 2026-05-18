# GitHub Actions IAM ロール設定ガイド

`.github/workflows/` の各 GitHub Actions ワークフローが、Terraform で作成した最小権限 IAM ロールに OIDC 経由で AssumeRole するための GitHub Secrets 設定方法をまとめます。

対象読者: 本リポジトリのインフラ運用担当者。

> **TL;DR**
> - 用途別の最小権限ロールを Terraform (`terraform/modules/app-infrastructure/iam_github_actions.tf`) で 7 個作成済み
> - 共通の ECR デプロイ用ロール 1 個を **Repository secret** に、環境別ロール 6 個 (stg/prod × 3 用途) を **Environment secrets** に登録する
> - Environment secrets は stg/prod それぞれの environment 内に**同じ secret 名で値だけ違える**ことで、ワークフロー YAML 側は単一の参照式で stg/prod を自動切り替えできる

以下の例では AWS アカウント ID を `123456789012` (架空) としています。実際の登録時は自身の AWS アカウント ID に置き換えてください。

---

## 1. 設定する Secrets 一覧

| Secret 名 | 配置場所 | 用途 | 対応 IAM ロール |
|---|---|---|---|
| `AWS_ECR_DEPLOY_ROLE_ARN` | Repository secret | ECR への Docker イメージ push | `react-hono-practice-github-actions-ecr-deploy-role` |
| `AWS_LAMBDA_UPDATE_ROLE_ARN` | Environment secret (`stg`) | Lambda コード更新 (stg) | `practice-stg-github-actions-lambda-update-role` |
| `AWS_LAMBDA_UPDATE_ROLE_ARN` | Environment secret (`prod`) | Lambda コード更新 (prod) | `practice-prod-github-actions-lambda-update-role` |
| `AWS_DB_TASK_INVOKE_ROLE_ARN` | Environment secret (`stg`) | db-task Lambda の invoke (stg) | `practice-stg-github-actions-db-task-invoke-role` |
| `AWS_DB_TASK_INVOKE_ROLE_ARN` | Environment secret (`prod`) | db-task Lambda の invoke (prod) | `practice-prod-github-actions-db-task-invoke-role` |
| `AWS_FRONTEND_DEPLOY_ROLE_ARN` | Environment secret (`stg`) | フロント S3 sync + CloudFront invalidate (stg) | `practice-stg-github-actions-frontend-deploy-role` |
| `AWS_FRONTEND_DEPLOY_ROLE_ARN` | Environment secret (`prod`) | フロント S3 sync + CloudFront invalidate (prod) | `practice-prod-github-actions-frontend-deploy-role` |

参照する workflow との対応:

| Workflow | 参照する Secret |
|---|---|
| `deploy-ecr-backend-lambda.yml` | `AWS_ECR_DEPLOY_ROLE_ARN` (Repository) |
| `update-lambda.yml` | `AWS_LAMBDA_UPDATE_ROLE_ARN` (Environment) |
| `invoke-db-task.yml` | `AWS_DB_TASK_INVOKE_ROLE_ARN` (Environment) |
| `s3-deploy-frontend.yml` | `AWS_FRONTEND_DEPLOY_ROLE_ARN` (Environment) |

`terraform-apply-plan.yml` / `terraform-stg-destroy.yml` が参照する `AWS_TERRAFORM_ROLE_ARN` は手動作成ロールのまま据え置きで、本ガイドの対象外です。

---

## 2. 設定値 (架空アカウント ID `123456789012`)

### Repository secret

```
AWS_ECR_DEPLOY_ROLE_ARN
  = arn:aws:iam::123456789012:role/react-hono-practice-github-actions-ecr-deploy-role
```

### Environment secret (`stg`)

```
AWS_LAMBDA_UPDATE_ROLE_ARN
  = arn:aws:iam::123456789012:role/practice-stg-github-actions-lambda-update-role

AWS_DB_TASK_INVOKE_ROLE_ARN
  = arn:aws:iam::123456789012:role/practice-stg-github-actions-db-task-invoke-role

AWS_FRONTEND_DEPLOY_ROLE_ARN
  = arn:aws:iam::123456789012:role/practice-stg-github-actions-frontend-deploy-role
```

### Environment secret (`prod`)

```
AWS_LAMBDA_UPDATE_ROLE_ARN
  = arn:aws:iam::123456789012:role/practice-prod-github-actions-lambda-update-role

AWS_DB_TASK_INVOKE_ROLE_ARN
  = arn:aws:iam::123456789012:role/practice-prod-github-actions-db-task-invoke-role

AWS_FRONTEND_DEPLOY_ROLE_ARN
  = arn:aws:iam::123456789012:role/practice-prod-github-actions-frontend-deploy-role
```

> **ヒント**: 実際のロール ARN は `terraform apply` 完了後、AWS マネジメントコンソールの「IAM → ロール」または `aws iam get-role --role-name <ロール名> --query 'Role.Arn'` で取得できます。

---

## 3. Repository secret の設定手順

`AWS_ECR_DEPLOY_ROLE_ARN` のみが対象です。

1. GitHub リポジトリのページを開きます。
2. **Settings → Secrets and variables → Actions** を選択します。
3. **Secrets** タブの **New repository secret** をクリックします。
4. 以下を入力して **Add secret** をクリックします。
   - **Name**: `AWS_ECR_DEPLOY_ROLE_ARN`
   - **Secret**: `arn:aws:iam::123456789012:role/react-hono-practice-github-actions-ecr-deploy-role`

---

## 4. Environment secret の設定手順

stg / prod それぞれに 3 つずつ、計 6 個の Environment secret を登録します。

### 4.1 Environment の作成 (まだ存在しない場合のみ)

1. **Settings → Environments** を選択します。
2. **New environment** をクリックします。
3. 名前に `stg` と入力して **Configure environment** をクリックします。
4. 同様に `prod` も作成します。

> **補足**: workflow 側で `environment: ${{ inputs.target_env }}` を指定しているため、environment 名は `stg` / `prod` と完全一致させてください (大文字小文字区別あり)。

### 4.2 Secret の登録

1. **Settings → Environments → stg** を開きます。
2. **Environment secrets** セクションの **Add environment secret** をクリックします。
3. 以下の 3 つを順に登録します。

   | Name | Secret |
   |---|---|
   | `AWS_LAMBDA_UPDATE_ROLE_ARN` | `arn:aws:iam::123456789012:role/practice-stg-github-actions-lambda-update-role` |
   | `AWS_DB_TASK_INVOKE_ROLE_ARN` | `arn:aws:iam::123456789012:role/practice-stg-github-actions-db-task-invoke-role` |
   | `AWS_FRONTEND_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/practice-stg-github-actions-frontend-deploy-role` |

4. `prod` environment についても同様に開き、以下の 3 つを登録します。

   | Name | Secret |
   |---|---|
   | `AWS_LAMBDA_UPDATE_ROLE_ARN` | `arn:aws:iam::123456789012:role/practice-prod-github-actions-lambda-update-role` |
   | `AWS_DB_TASK_INVOKE_ROLE_ARN` | `arn:aws:iam::123456789012:role/practice-prod-github-actions-db-task-invoke-role` |
   | `AWS_FRONTEND_DEPLOY_ROLE_ARN` | `arn:aws:iam::123456789012:role/practice-prod-github-actions-frontend-deploy-role` |

> **注意**: 登録後、secret の値は GitHub UI 上で再表示できません (上書き登録のみ可能)。コピペ時に前後の空白や改行が混入しやすいので、貼り付けた直後に余分な空白がないか目視確認してください。AccessDenied になった場合は一度 secret を削除して再登録するのが確実です。

### 4.3 (任意) Required reviewers の設定

`prod` environment では、`Settings → Environments → prod → Deployment protection rules` で `Required reviewers` を設定すると、prod へのデプロイ実行前に承認が必要になります。本番リリースの誤実行防止になります。

---

## 5. 旧 Secret との対応関係

ロールの分割に伴い、以下の旧 secret は新名へ移行しました。

| 旧 Secret 名 | 新 Secret 名 | 配置 | 備考 |
|---|---|---|---|
| `AWS_LAMBDA_DEPLOY_ROLE_ARN` (共通) | `AWS_LAMBDA_UPDATE_ROLE_ARN` + `AWS_DB_TASK_INVOKE_ROLE_ARN` | Environment (stg/prod) | 用途が混在していたため 2 つに分割 |
| `AWS_S3_DEPLOY_ROLE_ARN` | `AWS_FRONTEND_DEPLOY_ROLE_ARN` | Environment (stg/prod) | 命名を実態に合わせて変更 |
| `AWS_ECR_DEPLOY_ROLE_ARN` | (同名) | Repository | 名前は同じ。実体ロールが手動作成→ Terraform 管理に切り替わる |

### 移行手順

1. Terraform で新ロールを apply する (`terraform/stg/` で `terraform apply`)
2. 本ガイドのとおりに新 secret を登録する
3. workflow を `workflow_dispatch` で 1 つずつ実行し、各ロールで AssumeRole に成功することを確認する
4. 全 workflow が新ロールで正常動作するのを確認したのち、旧 secret (`AWS_LAMBDA_DEPLOY_ROLE_ARN`, `AWS_S3_DEPLOY_ROLE_ARN`) を **Settings → Secrets and variables → Actions** から削除する
5. 古い手動 IAM ロール (旧 `AWS_ECR_DEPLOY_ROLE_ARN` の実体ロール、Lambda/S3 用の共通ロール) を AWS コンソールから削除する

---

## 6. 動作確認

### 6.1 stg 環境での確認

それぞれの workflow を **Actions → 該当 workflow → Run workflow** から `target_env=stg` で `workflow_dispatch` 実行し、`Configure AWS credentials` ステップが成功することを確認します。

| Workflow | 確認ポイント |
|---|---|
| `deploy-ecr-backend-lambda.yml` | ECR に新しい image tag (`sha-<commit>`) が push されている |
| `update-lambda.yml` | `practice-stg-*` の 5 関数が新しい image-uri に更新されている |
| `invoke-db-task.yml` (`operation=migrate`) | 戻り値の `response.json` が成功ステータスを返す |
| `s3-deploy-frontend.yml` | フロント URL に最新ビルドが反映され、CloudFront invalidation が作成される |

### 6.2 prod 環境での確認

`prod` 用 secrets を `target_env=prod` で同様に検証します。事前に `required reviewers` を設定済みなら承認フローも走ることを確認します。

---

## 7. トラブルシューティング

### `Not authorized to perform sts:AssumeRoleWithWebIdentity`

信頼ポリシーの sub / ref / aud のいずれかが一致していません。確認順:

1. workflow の `environment:` が `stg` / `prod` のいずれかに一致しているか
2. workflow の実行ブランチが信頼ポリシーで許可されているか (stg は `main` / `develop`、prod は `main`)
3. secret に登録されている ARN が、対応する環境のロールになっているか (例: `target_env=stg` なのに prod 用 ARN が登録されている)

### `Could not load credentials from any providers`

`role-to-assume` で参照する secret が未登録、または environment secret なのに repository scope で登録されています。Environment secret は workflow に `environment:` 句がないと読めない点に注意してください。

### `AccessDenied: User: arn:aws:sts::...:assumed-role/... is not authorized to perform ...`

OIDC 認証は成功しているが、対象 AWS API へのポリシーが不足しています。`terraform/modules/app-infrastructure/iam_policy_github_actions.tf` の該当ポリシーに Action と Resource が含まれているか確認してください。

---

## 8. 関連ファイル

| ファイル | 役割 |
|---|---|
| `terraform/modules/app-infrastructure/iam_github_actions.tf` | OIDC ロール 7 個の定義 (信頼ポリシー) |
| `terraform/modules/app-infrastructure/iam_policy_github_actions.tf` | 各ロールにアタッチする最小権限ポリシー |
| `.github/workflows/deploy-ecr-backend-lambda.yml` | ECR push (Repository secret 利用) |
| `.github/workflows/update-lambda.yml` | Lambda コード更新 (Environment secret 利用) |
| `.github/workflows/invoke-db-task.yml` | db-task Lambda invoke (Environment secret 利用) |
| `.github/workflows/s3-deploy-frontend.yml` | フロント S3 デプロイ (Environment secret 利用) |
