variable "project_name" {
  description = "プロジェクトの名前"
  type        = string
}

variable "domain_name" {
  description = "Route53のドメイン名"
  type        = string
}

variable "sub_frontend_domain_name" {
  description = "Route53のサブドメイン名(フロントエンド)"
  type        = string
}

variable "db_name" {
  description = "RDSのデータベース名"
  type        = string
}

variable "db_username" {
  description = "RDSのユーザー名"
  type        = string
}

variable "parameter_store_path" {
  description = "Parameter Storeのパス"
  type        = string
}

variable "enable_nat_gateway" {
  description = "NAT Gatewayを有効化するかどうか"
  type        = bool
  default     = true
}

variable "alert_email_to" {
  description = "アラートの送信先メールアドレス"
  type        = string
}

variable "app_env" {
  description = "アプリケーションの環境（例: staging, production）"
  type        = string
  default     = "staging"
}

variable "ecr_repository_name" {
  description = "ECR リポジトリ名"
  type        = string
}

variable "image_tag" {
  description = "ECR イメージタグ"
  type        = string
}

variable "rds_multi_az" {
  description = "RDSをMulti-AZ構成にするかどうか（本番true推奨）"
  type        = bool
  default     = false
}

variable "rds_backup_retention_period" {
  description = "RDS自動バックアップの保持日数（0〜35）。0で自動バックアップ無効"
  type        = number
  default     = 7

  validation {
    condition     = var.rds_backup_retention_period >= 0 && var.rds_backup_retention_period <= 35
    error_message = "backup_retention_period は 0〜35 の範囲で指定してください。"
  }
}

variable "rds_instance_class" {
  description = "RDSインスタンスクラス（例: db.t4g.micro, db.t4g.medium, db.m6g.large）"
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_skip_final_snapshot" {
  description = "DB削除時に最終スナップショットの取得をスキップするか。本番はfalse推奨"
  type        = bool
  default     = true
}

variable "rds_apply_immediately" {
  description = "設定変更を即座に適用するか。本番はfalse推奨（メンテナンスウィンドウまで待つ）"
  type        = bool
  default     = true
}

variable "rds_enabled_cloudwatch_logs_exports" {
  description = "CloudWatch Logsへエクスポートするログ種別（error/slowquery/general/audit）"
  type        = list(string)
  default     = ["error"]
}

variable "rds_performance_insights_enabled" {
  description = "Performance Insightsの有効化。直近7日間は無料"
  type        = bool
  default     = false
}

variable "rds_monitoring_interval" {
  description = "Enhanced Monitoringのメトリクス取得間隔（秒）。0/1/5/10/15/30/60。0で無効"
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1, 5, 10, 15, 30, 60], var.rds_monitoring_interval)
    error_message = "monitoring_interval は 0/1/5/10/15/30/60 のいずれかを指定してください。"
  }
}
