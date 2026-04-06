# Lambda 用 SG
resource "aws_security_group" "lambda_sg" {
  name        = "${var.project_name}-lambda-sg"
  description = "${var.project_name}-lambda-sg"
  vpc_id      = module.vpc.vpc_id

  # Lambda は呼び出されるため ingress 不要
  # NAT Gateway 経由で外部サービス（Google OAuth、SES 等）にアクセス
  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-lambda-sg"
  }
}

# RDS Proxy 用 SG
resource "aws_security_group" "rds_proxy_sg" {
  name        = "${var.project_name}-rds-proxy-sg"
  description = "${var.project_name}-rds-proxy-sg"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "MySQL from Lambda"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda_sg.id]
  }

  egress {
    description = "Allow outbound to RDS"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-rds-proxy-sg"
  }
}

# RDS 用 SG
resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "${var.project_name}-rds-sg"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "MySQL from RDS Proxy"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.rds_proxy_sg.id]
  }

  ingress {
    description     = "MySQL from Secrets Manager rotation Lambda"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.rotation_lambda_sg.id]
  }

  tags = { Name = "${var.project_name}-rds-sg" }
}

# Secrets Manager ローテーション Lambda 用 SG
# ローテーション Lambda は RDS に直接接続してパスワードを変更し、
# Secrets Manager API を呼び出してシークレット値を更新する。
# NAT Gateway 経由で Secrets Manager API にアクセスするため、
# egress は全開放にしている。
resource "aws_security_group" "rotation_lambda_sg" {
  name        = "${var.project_name}-rotation-lambda-sg"
  description = "${var.project_name}-rotation-lambda-sg"
  vpc_id      = module.vpc.vpc_id

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-rotation-lambda-sg"
  }
}
