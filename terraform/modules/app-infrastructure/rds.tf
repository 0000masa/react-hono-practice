# RDS本体
resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  # MariaDB 11.x は RDS Proxy がサポートする認証方式（mysql_native_password）に
  # 対応しておらず、RDS Proxy のターゲット登録時にエラーになるため MySQL に変更。
  # RDS Proxy がサポートする MariaDB は 10.3〜10.6 のみ。
  engine                          = "mysql"
  engine_version                  = "8.4"
  instance_class                  = var.rds_instance_class
  allocated_storage               = 20
  storage_type                    = "gp3"
  db_name                         = var.db_name
  username                        = var.db_username
  password                        = data.aws_ssm_parameter.db_password.value
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.rds_sg.id]
  skip_final_snapshot             = var.rds_skip_final_snapshot
  publicly_accessible             = false
  storage_encrypted               = true
  copy_tags_to_snapshot           = true
  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = var.rds_enabled_cloudwatch_logs_exports
  maintenance_window              = "sun:15:00-sun:15:30"

  # Multi-AZ 構成（スタンバイDBを別AZに自動配置、障害時は1〜2分で自動フェイルオーバー）
  multi_az = var.rds_multi_az

  # 自動バックアップ（最大35日、PITR有効化の前提）
  backup_retention_period = var.rds_backup_retention_period
  backup_window           = "17:00-17:30" # UTC。JST 02:00-02:30（メンテナンスウィンドウと被らないように）

  # Performance Insights（直近7日間は無料）
  performance_insights_enabled = var.rds_performance_insights_enabled

  # Enhanced Monitoring（OS層メトリクスをCloudWatch Logsへ送信。0で無効）
  monitoring_interval = var.rds_monitoring_interval
  monitoring_role_arn = var.rds_monitoring_interval > 0 ? aws_iam_role.rds_enhanced_monitoring[0].arn : null

  # DBの変更をすぐに反映させるか
  apply_immediately = var.rds_apply_immediately

  tags = {
    Name = "${var.project_name}-db"
  }
}

# Enhanced Monitoring 用 IAM ロール（monitoring_interval > 0 のときのみ作成）
# AWS提供のマネージドポリシー AmazonRDSEnhancedMonitoringRole を使用
resource "aws_iam_role" "rds_enhanced_monitoring" {
  count = var.rds_monitoring_interval > 0 ? 1 : 0
  name  = "${var.project_name}-rds-enhanced-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  count      = var.rds_monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.rds_enhanced_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

#DBサブネットグループ
resource "aws_db_subnet_group" "main" {
  name = "${var.project_name}-db-subnet-group"
  subnet_ids = [
    local.private_subnet_a_id,
    local.private_subnet_c_id
  ]
  tags = {
    Name = "${var.project_name}-db-subnet-group"
  }
}
