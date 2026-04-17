project_name             = "practice-stg"
domain_name              = "mylabinfra.com"
sub_frontend_domain_name = "www"
db_name                  = "practice_db"
db_username              = "admin"
parameter_store_path     = "/practice/stg/"
ecr_repository_name      = "react-hono-practice-backend-lambda"
image_tag                = "sha-9bfdc0ba89d78c6c6486057857b885ecb1c802ee"
alert_email_to           = "mousetest12345@gmail.com"
app_env                  = "staging"

# --- RDS（ステージング設定） ---
# シングルAZ・短めのバックアップ保持・最小構成でコスト最適化
rds_multi_az                        = false
rds_backup_retention_period         = 3
rds_instance_class                  = "db.t4g.micro"
rds_skip_final_snapshot             = true
rds_apply_immediately               = true
rds_enabled_cloudwatch_logs_exports = ["error"]
rds_performance_insights_enabled    = false
rds_monitoring_interval             = 0