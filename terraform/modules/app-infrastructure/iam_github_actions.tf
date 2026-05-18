# ==============================================================================
# GitHub Actions OIDC 連携用 IAM ロール
# 各 GitHub Actions ワークフローに対して最小権限を付与するロールを定義する。
# OIDC プロバイダは AWS 上に既存のものを data source で参照する。
#
# 注意 (環境別ロールの信頼ポリシー):
#   ワークフロー側で `environment:` を指定すると OIDC トークンの `sub` は
#   `repo:OWNER/REPO:environment:NAME` 形式になり、`ref:refs/heads/...` 形式
#   にはならない。`sub` 単独では environment と branch を同時に縛れないため、
#   branch 制約は別クレーム `:ref` を condition に追加して併用する。
# ==============================================================================

data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  # 環境別ロールが許可する :ref クレームの値 (refs/heads/<branch>)
  github_actions_allowed_refs = [
    for branch in var.github_actions_allowed_branches :
    "refs/heads/${branch}"
  ]
}

# ------------------------------------------------------------------------------
# ECR push 用ロール（環境共通: stg 環境からのみ作成する）
# deploy-ecr-backend-lambda.yml はリポジトリ内の全ブランチ・PR・タグから実行可能。
# environment は指定していないため、sub は `repo:OWNER/REPO:ref:...` 形式が
# 来る前提で StringLike `repo:OWNER/REPO:*` でリポジトリのみを縛る。
# ------------------------------------------------------------------------------

module "github_actions_ecr_deploy_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  create = var.create_shared_github_actions_roles

  name            = "react-hono-practice-github-actions-ecr-deploy-role"
  use_name_prefix = false

  trust_policy_permissions = {
    github_oidc = {
      actions = ["sts:AssumeRoleWithWebIdentity"]
      principals = [{
        type        = "Federated"
        identifiers = [data.aws_iam_openid_connect_provider.github_actions.arn]
      }]
      condition = [
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:aud"
          values   = ["sts.amazonaws.com"]
        },
        {
          test     = "StringLike"
          variable = "token.actions.githubusercontent.com:sub"
          values   = ["repo:${var.github_repository}:*"]
        },
      ]
    }
  }

  policies = var.create_shared_github_actions_roles ? {
    GithubActionsEcrPush = aws_iam_policy.github_actions_ecr_push[0].arn
  } : {}
}

# ------------------------------------------------------------------------------
# Lambda update 用ロール（環境別）
# update-lambda.yml は environment: ${{ inputs.target_env }} を指定するため、
# sub には environment 値が入る。branch 制限は :ref クレームを併用する。
# ------------------------------------------------------------------------------

module "github_actions_lambda_update_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-github-actions-lambda-update-role"
  use_name_prefix = false

  trust_policy_permissions = {
    github_oidc = {
      actions = ["sts:AssumeRoleWithWebIdentity"]
      principals = [{
        type        = "Federated"
        identifiers = [data.aws_iam_openid_connect_provider.github_actions.arn]
      }]
      condition = [
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:aud"
          values   = ["sts.amazonaws.com"]
        },
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:sub"
          values   = ["repo:${var.github_repository}:environment:${var.app_env}"]
        },
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:ref"
          values   = local.github_actions_allowed_refs
        },
      ]
    }
  }

  policies = {
    GithubActionsLambdaUpdate = aws_iam_policy.github_actions_lambda_update.arn
  }
}

# ------------------------------------------------------------------------------
# DB task invoke 用ロール（環境別）
# invoke-db-task.yml も environment: を指定するため、Lambda update と同じく
# sub = environment、ref = ブランチ の 2 クレーム併用で縛る。
# ------------------------------------------------------------------------------

module "github_actions_db_task_invoke_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-github-actions-db-task-invoke-role"
  use_name_prefix = false

  trust_policy_permissions = {
    github_oidc = {
      actions = ["sts:AssumeRoleWithWebIdentity"]
      principals = [{
        type        = "Federated"
        identifiers = [data.aws_iam_openid_connect_provider.github_actions.arn]
      }]
      condition = [
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:aud"
          values   = ["sts.amazonaws.com"]
        },
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:sub"
          values   = ["repo:${var.github_repository}:environment:${var.app_env}"]
        },
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:ref"
          values   = local.github_actions_allowed_refs
        },
      ]
    }
  }

  policies = {
    GithubActionsDbTaskInvoke = aws_iam_policy.github_actions_db_task_invoke.arn
  }
}

# ------------------------------------------------------------------------------
# Frontend S3 deploy 用ロール（環境別）
# s3-deploy-frontend.yml も environment: を指定するため同じ条件構成。
# ------------------------------------------------------------------------------

module "github_actions_frontend_deploy_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-github-actions-frontend-deploy-role"
  use_name_prefix = false

  trust_policy_permissions = {
    github_oidc = {
      actions = ["sts:AssumeRoleWithWebIdentity"]
      principals = [{
        type        = "Federated"
        identifiers = [data.aws_iam_openid_connect_provider.github_actions.arn]
      }]
      condition = [
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:aud"
          values   = ["sts.amazonaws.com"]
        },
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:sub"
          values   = ["repo:${var.github_repository}:environment:${var.app_env}"]
        },
        {
          test     = "StringEquals"
          variable = "token.actions.githubusercontent.com:ref"
          values   = local.github_actions_allowed_refs
        },
      ]
    }
  }

  policies = {
    GithubActionsFrontendDeploy = aws_iam_policy.github_actions_frontend_deploy.arn
  }
}
