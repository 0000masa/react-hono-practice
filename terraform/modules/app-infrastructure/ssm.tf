# -----------------------------------------------------------------
# GitHub Actions連携用 SSMパラメータストア
# -----------------------------------------------------------------

# サブネットIDの保存
# Run Taskを実行するサブネット（Private Subnetを推奨）のIDを保存します。
resource "aws_ssm_parameter" "backend_subnet_id" {
  name        = "${var.parameter_store_path}subnet_id"
  description = "Subnet ID for ECS Run Task (Migration/Seeder)"
  type        = "String"
  value       = local.private_subnet_a_id
}

# セキュリティグループIDの保存
# ECSタスク（バックエンド）に割り当てるセキュリティグループIDを保存します。
resource "aws_ssm_parameter" "backend_security_group_id" {
  name        = "${var.parameter_store_path}security_group_id"
  description = "Security Group ID for ECS Run Task (Migration/Seeder)"
  type        = "String"
  value       = aws_security_group.ecs_sg.id
}

# フロントエンドバケット名の保存
resource "aws_ssm_parameter" "frontend_bucket_name" {
  name  = "${var.parameter_store_path}frontend_bucket_name"
  type  = "String"
  value = aws_s3_bucket.frontend_bucket.id
}

# CloudfrontのDistribution IDの保存
resource "aws_ssm_parameter" "cloudfront_distribution_id" {
  name  = "${var.parameter_store_path}cloudfront_distribution_id"
  type  = "String"
  value = aws_cloudfront_distribution.frontend_cdn.id
}

resource "aws_ssm_parameter" "backend_url" {
  name  = "${var.parameter_store_path}backend_url"
  type  = "String"
  value = "https://${var.sub_backend_domain_name}.${var.domain_name}"
}

resource "aws_ssm_parameter" "otel_collector_config" {
  name = "${var.parameter_store_path}otel-collector-config"
  type = "String"

  value = <<-YAML
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch: {}

exporters:
  awsxray: {}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [awsxray]
YAML
}
