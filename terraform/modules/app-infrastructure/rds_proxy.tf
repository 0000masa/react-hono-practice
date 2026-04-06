# ==============================================================================
# RDS Proxy（Lambda → RDS Proxy → RDS）
# Lambda からの接続をプールし、RDS への同時接続数を制御する
# 認証: Lambda → Proxy は IAM 認証、Proxy → RDS は Secrets Manager ベース
# ==============================================================================

# --- RDS Proxy 本体 ---
resource "aws_db_proxy" "main" {
  name                   = "${var.project_name}-rds-proxy"
  engine_family          = "MYSQL" # MariaDB も MYSQL ファミリー
  role_arn               = module.rds_proxy_role.arn
  # RDS Proxy は ALB と同様に VPC 内に ENI を作成してトラフィックを中継するマネージドサービス。
  # DB アクセスの仲介が目的でインターネットからの接続は不要なため、
  # プライベートサブネットに配置するのがベストプラクティス。
  vpc_subnet_ids         = [local.private_subnet_a_id, local.private_subnet_c_id]
  vpc_security_group_ids = [aws_security_group.rds_proxy_sg.id]
  require_tls            = true
  # クライアント（Lambda）が接続を張ったまま SQL クエリなどの通信を行っていない
  # 「アイドル状態」が続いた場合に、Proxy が自動で切断するまでの最大秒数。
  # 切断された DB 接続枠は Proxy 内部の共有プール（コネクションプール）に戻り、
  # 別の Lambda が再利用できるようになる。
  # RDS には同時接続数の上限があるため、使われていない接続を早めにプールに戻すことで
  # 接続枠不足を防ぐ。
  idle_client_timeout    = 1800 # 30分

  # --- 認証設定 ---
  # RDS Proxy には 2 方向の認証がある:
  #   Lambda → Proxy: iam_auth = "REQUIRED" により IAM 認証トークンの使用を必須化
  #   Proxy  → RDS  : auth_scheme = "SECRETS" により Secrets Manager から DB パスワードを取得して認証
  # secret_arn には secrets_manager.tf で定義した DB 認証情報のシークレットを指定する。
  auth {
    iam_auth                    = "REQUIRED"
    auth_scheme                 = "SECRETS"
    secret_arn                  = aws_secretsmanager_secret.rds_credentials.arn
    # MariaDB は MYSQL_NATIVE_PASSWORD のみサポート（デフォルトの MYSQL_CLEAR_PASSWORD は非対応）
    client_password_auth_type   = "MYSQL_NATIVE_PASSWORD"
  }

  tags = {
    Name = "${var.project_name}-rds-proxy"
  }
}

# --- デフォルトターゲットグループ ---
# RDS Proxy が接続を振り分ける先のグループ（ALB のターゲットグループに似た概念）。
# RDS Proxy には必ず 1 つのデフォルトターゲットグループが存在し、
# カスタムターゲットグループは作成できないため、実質これが唯一のグループ。
resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name

  # Proxy → RDS 間のコネクションプールの振る舞いを制御する設定
  connection_pool_config {
    # RDS の max_connections のうち、この Proxy が使える割合。
    # 100% = RDS の全接続枠を使える。
    max_connections_percent      = 100
    # プール内でアイドル状態のまま保持できる接続の割合。
    # 50% = 使われていなくても半分まではプールに保持しておく（次のリクエストですぐ使えるように）。
    max_idle_connections_percent = 50
    # Lambda がプールから接続を借りようとした際、空きがなければ最大この秒数だけ待つ。
    # それでも空かなければエラーになる。
    # これが効くのは、プールの接続が全て使用中という異常な高負荷時だけ
    connection_borrow_timeout    = 120
  }
}

# --- ターゲット（RDS インスタンス） ---
resource "aws_db_proxy_target" "main" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.main.identifier
}
