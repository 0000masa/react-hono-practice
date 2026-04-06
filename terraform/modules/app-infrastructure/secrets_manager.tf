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
}
