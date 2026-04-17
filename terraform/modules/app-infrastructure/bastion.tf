# ==============================================================================
# RDS への ad-hoc アクセス用の踏み台 EC2
#
# 用途:
#   Session Manager の AWS-StartPortForwardingSessionToRemoteHost ドキュメントで
#   ローカル PC / CloudShell から RDS (3306) に TCP 転送する。
#   SSH は使わない。踏み台自身で mysql コマンドを叩くことも想定していない。
#
# 設計:
#   - Amazon Linux 2023 arm64 (SSM Agent プリインストール済み)
#   - t4g.nano (月 ~$3、ap-northeast-1)
#   - プライベートサブネット配置、パブリック IP 無し
#   - SSM への outbound は既存の NAT Gateway 経由
#   - IMDSv2 強制、EBS 暗号化
# ==============================================================================

# 最新の AL2023 arm64 AMI ID を AWS 公式の SSM パブリックパラメータから取得
data "aws_ssm_parameter" "al2023_arm_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "bastion" {
  ami           = nonsensitive(data.aws_ssm_parameter.al2023_arm_ami.value)
  instance_type = "t4g.nano"

  subnet_id                   = local.private_subnet_a_id
  vpc_security_group_ids      = [aws_security_group.bastion_sg.id]
  associate_public_ip_address = false

  iam_instance_profile = module.bastion_role.iam_instance_profile_name

  # IMDSv2 強制
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-bastion"
  }

  # AMI はパッチにより定期的に更新される。毎回 re-create されないよう差分を無視する。
  # AMI を更新したい場合は terraform taint もしくは lifecycle 一時解除で対応する。
  lifecycle {
    ignore_changes = [ami]
  }
}
