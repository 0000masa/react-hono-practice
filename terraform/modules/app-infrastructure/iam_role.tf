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
# RDS Enhanced Monitoring 用 IAM ロール
# monitoring_interval > 0 のときだけ作成される
# AWS提供のマネージドポリシー AmazonRDSEnhancedMonitoringRole を付与
# ==============================================================================

module "rds_enhanced_monitoring_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  create = var.rds_monitoring_interval > 0

  name            = "${var.project_name}-rds-enhanced-monitoring"
  use_name_prefix = false

  trust_policy_permissions = {
    rds_monitoring = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["monitoring.rds.amazonaws.com"]
      }]
    }
  }

  policies = {
    AmazonRDSEnhancedMonitoringRole = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
  }
}

# ==============================================================================
# 踏み台 EC2 用 IAM ロール
# Session Manager で接続するために AmazonSSMManagedInstanceCore のみ付与する。
# RDS へは TCP 転送するだけで踏み台上で SQL を実行しないため、rds-db:connect 等は不要。
# create_instance_profile = true で aws_iam_instance_profile を同時に作成する。
# ==============================================================================

module "bastion_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role"

  name                    = "${var.project_name}-bastion-role"
  use_name_prefix         = false
  create_instance_profile = true

  trust_policy_permissions = {
    ec2 = {
      actions = ["sts:AssumeRole"]
      principals = [{
        type        = "Service"
        identifiers = ["ec2.amazonaws.com"]
      }]
    }
  }

  policies = {
    AmazonSSMManagedInstanceCore = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
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

