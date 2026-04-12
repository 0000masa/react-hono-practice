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
      GOOGLE_CLIENT_ID      = data.aws_ssm_parameter.google_client_id.value
      GOOGLE_CLIENT_SECRET  = data.aws_ssm_parameter.google_client_secret.value
      GOOGLE_CALLBACK_URL   = "https://${var.sub_frontend_domain_name}.${var.domain_name}/api/auth/google/callback"
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
# この設定により、Lambda サービスの内部コンポーネント（Event Source Mapping ポーラー）が
# SQS キューに対して自動的に Long Polling を行い、メッセージを検出すると Lambda を起動する。
# ポーリングは AWS がマネージドで運用するため、利用者側でコンピュートリソースを用意する必要はない。
# ポーリング時の SQS API コール（ReceiveMessage）は lambda_execution_role の権限で実行される。
# メッセージがない間は Lambda 関数は起動されないため、関数の実行課金は発生しない。
# 処理成功時はメッセージが自動削除され、失敗時は visibility_timeout 後にリトライされる。
# なお、Lambda の timeout（60s）は SQS の visibility_timeout（90s）より短くする必要がある。
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
# Secrets Manager ローテーション Lambda
# RDS のパスワードを定期的に自動変更するための Lambda 関数。
# AWS が公式に提供する SAR（Serverless Application Repository）テンプレートを使用する。
# テンプレート名: SecretsManagerRDSMySQLRotationSingleUser
#
# 処理の流れ:
#   1. Secrets Manager が スケジュール に従ってこの Lambda を呼び出す
#   2. Lambda が新しいパスワードを生成する
#   3. Lambda が RDS に接続して ALTER USER でパスワードを変更する
#   4. Lambda が Secrets Manager のシークレット値を新しいパスワードに更新する
#   5. RDS Proxy が次回接続時に新しいパスワードを自動取得する
# ==============================================================================

# SAR テンプレートからローテーション Lambda をデプロイ
# aws_serverlessapplicationrepository_cloudformation_stack は SAR のテンプレートを
# CloudFormation スタックとしてデプロイするリソース。
# SAR テンプレートの中身は Lambda 関数 + 必要なパーミッションの CloudFormation テンプレート。
resource "aws_serverlessapplicationrepository_cloudformation_stack" "rotation_lambda" {
  name             = "${var.project_name}-rds-rotation"
  # この ARN は AWS が SAR テンプレートを公開している固定のアカウント ID（297356227824）を含む。
  # 自分の AWS アカウント ID ではなく、AWS 公式のテンプレート公開元のため、ハードコードが正しい。
  application_id   = "arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSMySQLRotationSingleUser"
  semantic_version = "1.1.434"

  capabilities = ["CAPABILITY_IAM", "CAPABILITY_RESOURCE_POLICY"]

  parameters = {
    endpoint            = "https://secretsmanager.${data.aws_region.current.name}.amazonaws.com"
    functionName        = "${var.project_name}-rds-rotation"
    vpcSubnetIds        = join(",", [local.private_subnet_a_id, local.private_subnet_c_id])
    vpcSecurityGroupIds = aws_security_group.rotation_lambda_sg.id
  }
}

# Secrets Manager からローテーション Lambda を呼び出すためのパーミッション
resource "aws_lambda_permission" "secrets_manager_rotation" {
  function_name = "${var.project_name}-rds-rotation"
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = aws_secretsmanager_secret.rds_credentials.arn

  depends_on = [aws_serverlessapplicationrepository_cloudformation_stack.rotation_lambda]
}

# ==============================================================================
# サブスクリプションフィルターエラー通知 Lambda
# ==============================================================================
resource "aws_lambda_function" "notification_function" {
  function_name = "${var.project_name}-notifications-email"
  role          = module.notification_lambda_role.arn

  runtime          = "python3.11"
  handler          = "lambda_function.lambda_handler"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  timeout     = 30
  memory_size = 128

  environment {
    variables = {
      PROJECT_NAME     = var.project_name
      APP_ENV          = var.app_env
      ALERT_EMAIL_TO   = var.alert_email_to
      ALERT_EMAIL_FROM = "noreply@${var.sub_frontend_domain_name}.${var.domain_name}",
    }
  }
  lifecycle {
    ignore_changes = [filename, source_code_hash]
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

# LambdaがCloudWatch Logsから呼び出せるようにする
resource "aws_lambda_permission" "allow_cloudwatch_logs_invoke" {
  statement_id  = "AllowExecutionFromCloudWatchLogs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notification_function.function_name
  principal     = "logs.ap-northeast-1.amazonaws.com"
  source_arn    = "${aws_cloudwatch_log_group.lambda_api_log.arn}:*"
}

# SQS → Lambda の aws_lambda_permission は不要。
# SQS はプッシュ型（API Gateway / EventBridge / CloudWatch Logs のように Lambda を直接呼び出す）ではなく、
# Lambda サービスの内部コンポーネント（ポーラー）が SQS をポーリングして Lambda を起動するポーリング型のため、
# 外部サービスに Lambda の呼び出しを許可するリソースベースポリシー（aws_lambda_permission）は必要ない。
# 代わりに、ポーラーが SQS にアクセスするための IAM ポリシー（sqs:ReceiveMessage 等）を
# Lambda の実行ロールに付与する必要がある（iam_policy.tf の sqs_queue_policy を参照）。
