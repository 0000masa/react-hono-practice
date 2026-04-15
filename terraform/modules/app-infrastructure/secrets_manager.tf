# ==============================================================================
# Secrets Manager（RDS Proxy 用の DB 認証情報）
# RDS Proxy は Secrets Manager からのみ認証情報を取得できる
# ==============================================================================

# --- シークレットの「箱」（メタデータ） ---
# 名前や説明を定義するが、中身（値）は持たない。
# Secrets Manager はシークレットの管理単位（secret）と値のバージョン（secret_version）を
# 分離する設計のため、箱と中身で 2 つのリソースが必要。
resource "aws_secretsmanager_secret" "rds_credentials" {
  name        = "${var.project_name}/rds-credentials"
  description = "RDS credentials for RDS Proxy"
}

# --- シークレットの「中身」（実際の認証情報） ---
# 上で作成した箱に、username と password を JSON で格納する。
resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id = aws_secretsmanager_secret.rds_credentials.id

  secret_string = jsonencode({
    username = var.db_username
    password = data.aws_ssm_parameter.db_password.value
  })

  # ローテーションによってシークレットの値が更新されるため、
  # Terraform が毎回差分を検出して上書きしないように ignore する。
  # 初回作成時のみ SSM の値で設定し、以降はローテーション Lambda が管理する。
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- 自動ローテーション設定 ---
# Secrets Manager がスケジュールに従ってローテーション Lambda を呼び出し、
# RDS のパスワードとシークレットの値を自動的に更新する。
# RDS Proxy は次回の DB 接続時に新しいパスワードを自動取得するため、
# RDS Proxy 側の設定変更は不要。
resource "aws_secretsmanager_secret_rotation" "rds_credentials" {
  secret_id           = aws_secretsmanager_secret.rds_credentials.id
  rotation_lambda_arn = "arn:aws:lambda:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-rds-rotation"

  rotation_rules {
    # 30 日ごとにパスワードをローテーション（AWS 推奨のデフォルト値）
    automatically_after_days = 30
  }

  depends_on = [
    aws_serverlessapplicationrepository_cloudformation_stack.rotation_lambda,
    aws_lambda_permission.secrets_manager_rotation,
  ]
}
