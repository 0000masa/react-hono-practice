# ==============================================================================
# Lambda 実行ロール
# ==============================================================================

module "lambda_execution_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-lambda-execution-role"
  use_name_prefix = false

  trust_policy_permissions = {
    lambda = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["lambda.amazonaws.com"]
      }]
    }
  }

  policies = {
    AWSLambdaBasicExecutionRole      = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    AWSLambdaVPCAccessExecutionRole  = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
    LambdaS3Policy                   = aws_iam_policy.lambda_s3_policy.arn
    LambdaSesSendPolicy              = aws_iam_policy.ses_send_policy.arn
    LambdaSqsPolicy                  = aws_iam_policy.sqs_queue_policy.arn
    LambdaSsmPolicy                  = aws_iam_policy.lambda_ssm_policy.arn
    LambdaRdsProxyPolicy             = aws_iam_policy.lambda_rds_proxy_policy.arn
  }
}

# ==============================================================================
# EventBridge 用 IAM ロール
# ==============================================================================

module "eventbridge_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-eventbridge-role"
  use_name_prefix = false

  trust_policy_permissions = {
    events = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["events.amazonaws.com"]
      }]
    }
  }

  policies = {
    EventBridgeLambdaInvoke = aws_iam_policy.eventbridge_lambda_invoke.arn
  }
}

# ==============================================================================
# RDS Proxy 用 IAM ロール
# ==============================================================================

module "rds_proxy_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-rds-proxy-role"
  use_name_prefix = false

  trust_policy_permissions = {
    rds = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["rds.amazonaws.com"]
      }]
    }
  }

  policies = {
    RdsProxySecrets = aws_iam_policy.rds_proxy_secrets.arn
  }
}

# ==============================================================================
# Secrets Manager ローテーション Lambda 用 IAM ロール
# ==============================================================================

module "rotation_lambda_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-rotation-lambda-role"
  use_name_prefix = false

  trust_policy_permissions = {
    lambda = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["lambda.amazonaws.com"]
      }]
    }
  }

  policies = {
    AWSLambdaBasicExecutionRole     = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    AWSLambdaVPCAccessExecutionRole = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
    RotationPolicy                  = aws_iam_policy.rotation_lambda_policy.arn
  }
}

# ==============================================================================
# 通知 Lambda 用 IAM ロール（既存の通知Lambda用、変更なし）
# ==============================================================================

module "notification_lambda_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name            = "${var.project_name}-notification-lambda-role"
  use_name_prefix = false

  trust_policy_permissions = {
    lambda = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["lambda.amazonaws.com"]
      }]
    }
  }

  policies = {
    LambdaBasicExecutionRole    = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    LambdaReadHonoLogsPolicy = aws_iam_policy.lambda_read_hono_logs.arn,
    LambdaSesSendPolicy         = aws_iam_policy.ses_send_policy.arn,
  }
}

