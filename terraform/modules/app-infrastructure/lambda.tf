# ==============================================================================
# Lambda 関数（API / SQSワーカー / マイグレーション / 日次レポート）
# ==============================================================================

# --- ECR リポジトリ参照 ---
# ECR リポジトリは別途作成済みの前提。イメージは GitHub Actions でプッシュする。
data "aws_ecr_repository" "backend" {
  name = var.ecr_repository_name
}

locals {
  lambda_image_uri = "${data.aws_ecr_repository.backend.repository_url}:${var.image_tag}"
}

# ==============================================================================
# API Lambda（メインの Hono アプリケーション）
# ==============================================================================

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-api"
  role          = module.lambda_execution_role.arn
  package_type  = "Image"
  image_uri     = local.lambda_image_uri
  memory_size   = 1024
  timeout       = 29 # API Gateway の最大タイムアウトは 30 秒

  image_config {
    command = ["lambda.handler"]
  }

  vpc_config {
    subnet_ids         = [local.private_subnet_a_id, local.private_subnet_c_id]
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      NODE_ENV              = var.app_env
      DATABASE_HOST         = aws_db_proxy.main.endpoint
      DATABASE_PORT         = "3306"
      DATABASE_NAME         = var.db_name
      DATABASE_USERNAME     = var.db_username
      DATABASE_USE_IAM_AUTH = "true"
      FRONTEND_URL          = "https://${var.sub_frontend_domain_name}.${var.domain_name}"
      S3_BUCKET             = aws_s3_bucket.image_bucket.id
      S3_REGION             = "ap-northeast-1"
      CLOUDFRONT_URL        = "https://${aws_cloudfront_distribution.image_cdn.domain_name}"
      SES_REGION            = "ap-northeast-1"
      MAIL_FROM             = "noreply@${aws_ses_domain_mail_from.main.mail_from_domain}"
      SQS_QUEUE_URL         = aws_sqs_queue.qrcode_generation.url
      APP_ENV               = var.app_env
    }
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = {
    Name = "${var.project_name}-api"
  }
}

# ==============================================================================
# SQS ワーカー Lambda（QR コード非同期生成）
# ==============================================================================

resource "aws_lambda_function" "sqs_worker" {
  function_name = "${var.project_name}-sqs-worker"
  role          = module.lambda_execution_role.arn
  package_type  = "Image"
  image_uri     = local.lambda_image_uri
  memory_size   = 1024
  timeout       = 60 # SQS visibility_timeout (90s) より短くする

  image_config {
    command = ["sqs-handler.handler"]
  }

  vpc_config {
    subnet_ids         = [local.private_subnet_a_id, local.private_subnet_c_id]
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      NODE_ENV              = var.app_env
      DATABASE_HOST         = aws_db_proxy.main.endpoint
      DATABASE_PORT         = "3306"
      DATABASE_NAME         = var.db_name
      DATABASE_USERNAME     = var.db_username
      DATABASE_USE_IAM_AUTH = "true"
      S3_BUCKET             = aws_s3_bucket.image_bucket.id
      S3_REGION             = "ap-northeast-1"
      CLOUDFRONT_URL        = "https://${aws_cloudfront_distribution.image_cdn.domain_name}"
      APP_ENV               = var.app_env
    }
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = {
    Name = "${var.project_name}-sqs-worker"
  }
}

# SQS → Lambda イベントソースマッピング
resource "aws_lambda_event_source_mapping" "qrcode_worker" {
  event_source_arn = aws_sqs_queue.qrcode_generation.arn
  function_name    = aws_lambda_function.sqs_worker.arn
  batch_size       = 1
  enabled          = true
}

# ==============================================================================
# マイグレーション Lambda
# ==============================================================================

resource "aws_lambda_function" "migration" {
  function_name = "${var.project_name}-migration"
  role          = module.lambda_execution_role.arn
  package_type  = "Image"
  image_uri     = local.lambda_image_uri
  memory_size   = 512
  timeout       = 900 # 最大 15 分

  image_config {
    command = ["migrate.handler"]
  }

  vpc_config {
    subnet_ids         = [local.private_subnet_a_id, local.private_subnet_c_id]
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      NODE_ENV              = var.app_env
      DATABASE_HOST         = aws_db_proxy.main.endpoint
      DATABASE_PORT         = "3306"
      DATABASE_NAME         = var.db_name
      DATABASE_USERNAME     = var.db_username
      DATABASE_USE_IAM_AUTH = "true"
      APP_ENV               = var.app_env
    }
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = {
    Name = "${var.project_name}-migration"
  }
}

# ==============================================================================
# 日次レポート Lambda
# ==============================================================================

resource "aws_lambda_function" "daily_report" {
  function_name = "${var.project_name}-daily-report"
  role          = module.lambda_execution_role.arn
  package_type  = "Image"
  image_uri     = local.lambda_image_uri
  memory_size   = 512
  timeout       = 300

  image_config {
    command = ["daily-report.handler"]
  }

  vpc_config {
    subnet_ids         = [local.private_subnet_a_id, local.private_subnet_c_id]
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      NODE_ENV              = var.app_env
      DATABASE_HOST         = aws_db_proxy.main.endpoint
      DATABASE_PORT         = "3306"
      DATABASE_NAME         = var.db_name
      DATABASE_USERNAME     = var.db_username
      DATABASE_USE_IAM_AUTH = "true"
      SES_REGION            = "ap-northeast-1"
      MAIL_FROM             = "noreply@${aws_ses_domain_mail_from.main.mail_from_domain}"
      ALERT_EMAIL_TO        = var.alert_email_to
      APP_ENV               = var.app_env
    }
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  tags = {
    Name = "${var.project_name}-daily-report"
  }
}

# ==============================================================================
# Lambda パーミッション
# ==============================================================================

# API Gateway → API Lambda
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*"
}

# EventBridge → 日次レポート Lambda
resource "aws_lambda_permission" "eventbridge_daily_report" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.daily_report.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_report.arn
}
