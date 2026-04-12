# ==============================================================================
# EventBridge + Lambda バッチ処理（日次レポート）
# 毎日 UTC 00:00（JST 09:00）に日次レポート Lambda を実行
# ==============================================================================

# --- EventBridge ルール（毎日 UTC 00:00 = JST 09:00） ---
resource "aws_cloudwatch_event_rule" "daily_report" {
  name                = "${var.project_name}-daily-report"
  description         = "毎日 UTC 00:00（JST 09:00）に日次レポートバッチを実行"
  # TODO: テスト後に元に戻す → cron(0 0 * * ? *)
  schedule_expression = "cron(30 6 * * ? *)"
}

# --- EventBridge ターゲット（Lambda） ---
resource "aws_cloudwatch_event_target" "daily_report" {
  rule      = aws_cloudwatch_event_rule.daily_report.name
  target_id = "${var.project_name}-daily-report-lambda"
  arn       = aws_lambda_function.daily_report.arn
}
