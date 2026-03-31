module "app" {
  source = "../modules/app-infrastructure"

  project_name             = var.project_name
  domain_name              = var.domain_name
  sub_frontend_domain_name = var.sub_frontend_domain_name
  sub_backend_domain_name  = var.sub_backend_domain_name
  db_name                  = var.db_name
  db_username              = var.db_username
  parameter_store_path     = var.parameter_store_path
  enable_nat_gateway       = var.enable_nat_gateway
  alert_email_to           = var.alert_email_to
  app_env                  = var.app_env

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}
