# RDS本体
resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "mariadb"
  engine_version = "11.4" # ←ここを11.4系に固定
  instance_class = "db.t4g.micro"
  # instance_class                  = "db.t4g.medium"
  allocated_storage               = 20
  storage_type                    = "gp3"
  db_name                         = var.db_name
  username                        = var.db_username # variables.tfで定義した変数を参照
  password                        = data.aws_ssm_parameter.db_password.value
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.rds_sg.id]
  skip_final_snapshot             = true
  publicly_accessible             = false
  storage_encrypted               = true
  copy_tags_to_snapshot           = true
  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = ["error"] # general/auditは必要になってからでOK
  maintenance_window              = "sun:15:00-sun:15:30"
  # Performance Insights 自体をON
  # performance_insights_enabled = true

  # DBの変更をすぐに反映させる
  apply_immediately = true

  tags = {
    Name = "${var.project_name}-db"
  }
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
