# ==============================================================================
# CloudWatch ロググループ
# ==============================================================================

# API Lambda 用ロググループ
resource "aws_cloudwatch_log_group" "lambda_api_log" {
  name              = "/aws/lambda/${var.project_name}-api"
  retention_in_days = 30
}

# SQS ワーカー Lambda 用ロググループ
resource "aws_cloudwatch_log_group" "lambda_sqs_worker_log" {
  name              = "/aws/lambda/${var.project_name}-sqs-worker"
  retention_in_days = 30
}

# マイグレーション Lambda 用ロググループ
resource "aws_cloudwatch_log_group" "lambda_migration_log" {
  name              = "/aws/lambda/${var.project_name}-migration"
  retention_in_days = 30
}

# 日次レポート Lambda 用ロググループ
resource "aws_cloudwatch_log_group" "lambda_daily_report_log" {
  name              = "/aws/lambda/${var.project_name}-daily-report"
  retention_in_days = 30
}

# ==============================================================================
# CloudWatch ログサブスクリプションフィルター（エラー通知 Lambda へ）
# ==============================================================================

# API Lambda のエラーログを通知 Lambda に流す
resource "aws_cloudwatch_log_subscription_filter" "lambda_error_to_notification" {
  name           = "${var.project_name}-lambda-error-to-notification"
  log_group_name = aws_cloudwatch_log_group.lambda_api_log.name

  # ERROR または CRITICAL を含むログをマッチ
  filter_pattern  = "?ERROR ?CRITICAL"
  destination_arn = aws_lambda_function.notification_function.arn

  depends_on = [aws_lambda_permission.allow_cloudwatch_logs_invoke]
}

# ==============================================================================
# CloudWatch アラーム（Lambda エラー監視）
# ==============================================================================

# API Lambda のエラー率アラーム
resource "aws_cloudwatch_metric_alarm" "lambda_api_errors" {
  alarm_name          = "${var.project_name}-lambda-api-errors"
  alarm_description   = "API Lambda function errors detected"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  metric_name = "Errors"
  namespace   = "AWS/Lambda"
  statistic   = "Sum"
  period      = 60

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  alarm_actions = [aws_sns_topic.ecs_task_shortage.arn]
  ok_actions    = [aws_sns_topic.ecs_task_shortage.arn]
}

# API Lambda のスロットリングアラーム
resource "aws_cloudwatch_metric_alarm" "lambda_api_throttles" {
  alarm_name          = "${var.project_name}-lambda-api-throttles"
  alarm_description   = "API Lambda function throttles detected"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  metric_name = "Throttles"
  namespace   = "AWS/Lambda"
  statistic   = "Sum"
  period      = 60

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  alarm_actions = [aws_sns_topic.ecs_task_shortage.arn]
  ok_actions    = [aws_sns_topic.ecs_task_shortage.arn]
}
