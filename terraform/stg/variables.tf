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