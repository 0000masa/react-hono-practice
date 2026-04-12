# ==============================================================================
# CloudWatch ロググループ
# Lambda は実行時に /aws/lambda/{function_name} のロググループへ自動的にログを出力する。
# 事前に Terraform で作成しておくことで retention_in_days 等の設定を制御する。
# （事前作成しない場合、Lambda が無期限保持のロググループを自動作成する）
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

# API Lambda のエラーアラーム
# API Lambda でエラー（未処理例外やタイムアウト等）が 1 回でも発生したら SNS 経由でメール通知する。
resource "aws_cloudwatch_metric_alarm" "lambda_api_errors" {
  alarm_name        = "${var.project_name}-lambda-api-errors"
  alarm_description = "API Lambda function errors detected"

  # --- 評価条件 ---
  # comparison_operator: メトリクス値と threshold の比較方法。GreaterThanThreshold = 閾値を超えたらアラーム
  comparison_operator = "GreaterThanThreshold"
  # threshold: 閾値。0 に設定しているため、エラーが 1 件でもあれば発火する
  threshold = 0
  # evaluation_periods: 評価対象とする直近の期間数（period × evaluation_periods の時間幅を見る）
  evaluation_periods = 1
  # datapoints_to_alarm: evaluation_periods のうち何回閾値を超えたらアラームにするか
  #   1/1 = 直近 1 期間中 1 回でも超えたら即アラーム
  datapoints_to_alarm = 1
  # treat_missing_data: データポイントがない期間（Lambda が一度も呼ばれなかった等）の扱い
  #   notBreaching = データなし期間は「正常」扱いにする（誤アラームを防ぐ）
  treat_missing_data = "notBreaching"

  # --- 監視対象メトリクス ---
  # metric_name: CloudWatch メトリクス名。Errors = Lambda 実行でエラーになった回数
  metric_name = "Errors"
  # namespace: メトリクスの名前空間。AWS/Lambda = AWS が自動発行する Lambda 標準メトリクス
  namespace = "AWS/Lambda"
  # statistic: 集計方法。Sum = 期間内のエラー回数の合計
  statistic = "Sum"
  # period: 1 データポイントの集計期間（秒）。60 = 1 分ごとに集計
  period = 60

  # dimensions: メトリクスのフィルタ条件。特定の Lambda 関数に絞り込む
  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  # --- 通知先 ---
  # alarm_actions: ALARM 状態になったとき（エラー検知時）に通知する SNS トピック
  alarm_actions = [aws_sns_topic.alert.arn]
  # ok_actions: OK 状態に戻ったとき（エラーが解消したとき）に通知する SNS トピック
  ok_actions = [aws_sns_topic.alert.arn]
}

# API Lambda のスロットリングアラーム
# Lambda の同時実行数上限に達してリクエストが拒否（スロットリング）されたら SNS 経由でメール通知する。
# スロットリングが発生するとクライアントには 429/502 が返るため、早期に検知して対処が必要。
resource "aws_cloudwatch_metric_alarm" "lambda_api_throttles" {
  alarm_name        = "${var.project_name}-lambda-api-throttles"
  alarm_description = "API Lambda function throttles detected"

  # 評価条件はエラーアラームと同一（1 分間に 1 回でも発生したら即アラーム）
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  # metric_name: Throttles = 同時実行数制限によりリクエストが拒否された回数
  metric_name = "Throttles"
  namespace   = "AWS/Lambda"
  statistic   = "Sum"
  period      = 60

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }

  alarm_actions = [aws_sns_topic.alert.arn]
  ok_actions    = [aws_sns_topic.alert.arn]
}
