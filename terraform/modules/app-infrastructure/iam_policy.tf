# ==============================================================================
# IAM ポリシー
# ==============================================================================

# S3 アクセス（画像バケット）
resource "aws_iam_policy" "lambda_s3_policy" {
  name        = "${var.project_name}-lambda-s3-policy"
  description = "Allow Lambda to upload/delete images in S3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ObjectRW"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.image_bucket.arn}/*"
      },
      {
        Sid    = "S3ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.image_bucket.arn
      }
    ]
  })
}

# SES 送信
resource "aws_iam_policy" "ses_send_policy" {
  name        = "${var.project_name}-ses-send-policy"
  description = "Allow sending email via SES domain"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Effect   = "Allow"
        Resource = aws_ses_domain_identity.main.arn
      }
    ]
  })
}

# SQS アクセス
resource "aws_iam_policy" "sqs_queue_policy" {
  name        = "${var.project_name}-sqs-queue-policy"
  description = "Allow Lambda to send/receive messages from SQS queue"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSqsAccess"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.qrcode_generation.arn
      }
    ]
  })
}

# SSM パラメータ読み取り
resource "aws_iam_policy" "lambda_ssm_policy" {
  name = "${var.project_name}-lambda-ssm-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameters",
          "ssm:GetParameter"
        ]
        Resource = [
          data.aws_ssm_parameter.db_password.arn,
          data.aws_ssm_parameter.app_key.arn,
          data.aws_ssm_parameter.google_client_id.arn,
          data.aws_ssm_parameter.google_client_secret.arn,
        ]
      }
    ]
  })
}

# RDS Proxy IAM 認証
resource "aws_iam_policy" "lambda_rds_proxy_policy" {
  name        = "${var.project_name}-lambda-rds-proxy-policy"
  description = "Allow Lambda to connect to RDS Proxy via IAM auth"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "rds-db:connect"
        Resource = "arn:aws:rds-db:ap-northeast-1:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_proxy.main.id}/${var.db_username}"
      }
    ]
  })
}

# EventBridge → Lambda 呼び出し
resource "aws_iam_policy" "eventbridge_lambda_invoke" {
  name        = "${var.project_name}-eventbridge-lambda-invoke"
  description = "Allow EventBridge to invoke Lambda functions"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowInvokeLambda"
        Effect = "Allow"
        Action = "lambda:InvokeFunction"
        Resource = aws_lambda_function.daily_report.arn
      }
    ]
  })
}

# 通知 Lambda 用: CloudWatch Logs 読み取り
resource "aws_iam_policy" "lambda_read_laravel_logs" {
  name = "${var.project_name}-lambda-read-laravel-logs"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadLaravelLogs"
        Effect = "Allow"
        Action = [
          "logs:FilterLogEvents"
        ]
        Resource = [
          "${aws_cloudwatch_log_group.lambda_api_log.arn}:*"
        ]
      }
    ]
  })
}
