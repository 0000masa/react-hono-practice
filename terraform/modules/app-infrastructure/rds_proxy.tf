# ==============================================================================
# RDS Proxy（Lambda → RDS Proxy → RDS）
# Lambda からの接続をプールし、RDS への同時接続数を制御する
# 認証: Lambda → Proxy は IAM 認証、Proxy → RDS は Secrets Manager ベース
# ==============================================================================

# --- RDS Proxy 本体 ---
resource "aws_db_proxy" "main" {
  name                   = "${var.project_name}-rds-proxy"
  engine_family          = "MYSQL" # MariaDB も MYSQL ファミリー
  role_arn               = module.rds_proxy_role.iam_role_arn
  vpc_subnet_ids         = [local.private_subnet_a_id, local.private_subnet_c_id]
  vpc_security_group_ids = [aws_security_group.rds_proxy_sg.id]
  require_tls            = true
  idle_client_timeout    = 1800 # 30分

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "REQUIRED"
    secret_arn  = aws_secretsmanager_secret.rds_credentials.arn
  }

  tags = {
    Name = "${var.project_name}-rds-proxy"
  }
}

# --- デフォルトターゲットグループ ---
resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name

  connection_pool_config {
    max_connections_percent      = 100
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

# --- ターゲット（RDS インスタンス） ---
resource "aws_db_proxy_target" "main" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.main.identifier
}
