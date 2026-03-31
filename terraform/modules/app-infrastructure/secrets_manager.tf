# ==============================================================================
# Secrets Manager（RDS Proxy 用の DB 認証情報）
# RDS Proxy は Secrets Manager からのみ認証情報を取得できる
# ==============================================================================

resource "aws_secretsmanager_secret" "rds_credentials" {
  name        = "${var.project_name}/rds-credentials"
  description = "RDS credentials for RDS Proxy"
}

resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id = aws_secretsmanager_secret.rds_credentials.id

  secret_string = jsonencode({
    username = var.db_username
    password = data.aws_ssm_parameter.db_password.value
  })
}
