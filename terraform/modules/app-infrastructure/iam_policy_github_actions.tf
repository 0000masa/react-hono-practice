# ==============================================================================
# GitHub Actions OIDC ロール用 IAM ポリシー
# iam_github_actions.tf で定義したロールにアタッチされるカスタムポリシー群
# ==============================================================================

# ------------------------------------------------------------------------------
# ECR push 用ポリシー
# deploy-ecr-backend-lambda.yml で Docker イメージを backend Lambda 用 ECR に push する
# ------------------------------------------------------------------------------

resource "aws_iam_policy" "github_actions_ecr_push" {
  count = var.create_shared_github_actions_roles ? 1 : 0

  name        = "react-hono-practice-github-actions-ecr-push-policy"
  description = "Allow GitHub Actions to push Docker images to the backend ECR repository"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
        ]
        Resource = data.aws_ecr_repository.backend.arn
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambda update 用ポリシー（環境別）
# update-lambda.yml が ECR から image-uri を解決し、5 つの Lambda 関数のコードを更新する
# ------------------------------------------------------------------------------

resource "aws_iam_policy" "github_actions_lambda_update" {
  name        = "${var.project_name}-github-actions-lambda-update-policy"
  description = "Allow GitHub Actions to update Lambda function code in ${var.project_name}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrRead"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeImages",
        ]
        Resource = data.aws_ecr_repository.backend.arn
      },
      {
        # `aws lambda wait function-updated` は GetFunctionConfiguration をポーリングして
        # LastUpdateStatus を確認する。UpdateFunctionCode / GetFunction とは別アクションのため明示。
        Sid    = "LambdaUpdate"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
        ]
        Resource = [
          aws_lambda_function.api.arn,
          aws_lambda_function.sqs_worker.arn,
          aws_lambda_function.db_task.arn,
          aws_lambda_function.daily_report.arn,
          aws_lambda_function.notification_function.arn,
        ]
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# DB task invoke 用ポリシー（環境別）
# invoke-db-task.yml が db-task Lambda 1 個だけを invoke する
# ------------------------------------------------------------------------------

resource "aws_iam_policy" "github_actions_db_task_invoke" {
  name        = "${var.project_name}-github-actions-db-task-invoke-policy"
  description = "Allow GitHub Actions to invoke the db-task Lambda in ${var.project_name}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeDbTask"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.db_task.arn
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Frontend S3 deploy 用ポリシー（環境別）
# s3-deploy-frontend.yml が以下を実行:
#   1. SSM Parameter Store から frontend_bucket_name と cloudfront_distribution_id を取得
#   2. ビルド成果物を frontend バケットへ aws s3 sync --delete
#   3. CloudFront distribution のキャッシュ invalidation
# ------------------------------------------------------------------------------

resource "aws_iam_policy" "github_actions_frontend_deploy" {
  name        = "${var.project_name}-github-actions-frontend-deploy-policy"
  description = "Allow GitHub Actions to deploy frontend assets and invalidate CloudFront cache in ${var.project_name}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SsmReadDeployTargets"
        Effect = "Allow"
        Action = "ssm:GetParameter"
        Resource = [
          aws_ssm_parameter.frontend_bucket_name.arn,
          aws_ssm_parameter.cloudfront_distribution_id.arn,
        ]
      },
      {
        Sid      = "S3ListFrontendBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.frontend_bucket.arn
      },
      {
        Sid    = "S3SyncFrontendBucket"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject",
        ]
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/*"
      },
      {
        Sid      = "CloudFrontInvalidate"
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = aws_cloudfront_distribution.frontend_cdn.arn
      },
    ]
  })
}
