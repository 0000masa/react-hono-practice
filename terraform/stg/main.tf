module "app" {
  source = "../modules/app-infrastructure"

  project_name             = var.project_name
  domain_name              = var.domain_name
  sub_frontend_domain_name = var.sub_frontend_domain_name
  db_name                  = var.db_name
  db_username              = var.db_username
  parameter_store_path     = var.parameter_store_path
  enable_nat_gateway       = var.enable_nat_gateway
  alert_email_to           = var.alert_email_to
  app_env                  = var.app_env
  ecr_repository_name      = var.ecr_repository_name
  image_tag                = var.image_tag

  rds_multi_az                        = var.rds_multi_az
  rds_backup_retention_period         = var.rds_backup_retention_period
  rds_instance_class                  = var.rds_instance_class
  rds_skip_final_snapshot             = var.rds_skip_final_snapshot
  rds_apply_immediately               = var.rds_apply_immediately
  rds_enabled_cloudwatch_logs_exports = var.rds_enabled_cloudwatch_logs_exports
  rds_performance_insights_enabled    = var.rds_performance_insights_enabled
  rds_monitoring_interval             = var.rds_monitoring_interval

  github_repository                  = var.github_repository
  github_actions_allowed_branches    = var.github_actions_allowed_branches
  github_environment_name            = var.github_environment_name
  create_shared_github_actions_roles = true

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}
