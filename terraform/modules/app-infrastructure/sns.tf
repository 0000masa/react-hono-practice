
# --- SNS topic ---
resource "aws_sns_topic" "alert" {
  name = "${var.project_name}-alert"
}

# --- SNS subscription (email) ---
resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alert.arn
  protocol  = "email"
  endpoint  = var.alert_email_to
}
