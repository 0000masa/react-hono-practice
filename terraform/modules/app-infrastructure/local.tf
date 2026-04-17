# イメージURIをローカル変数に定義
locals {
  lambda_image_uri = "${data.aws_ecr_repository.backend.repository_url}:${var.image_tag}"
}

#VPCのサブネット
locals {
  public_subnet_a_id  = module.vpc.public_subnets[0]
  public_subnet_c_id  = module.vpc.public_subnets[1]
  private_subnet_a_id = module.vpc.private_subnets[0]
  private_subnet_c_id = module.vpc.private_subnets[1]
}
