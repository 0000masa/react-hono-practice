# --- Cluster ---
resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"
  setting {
    name = "containerInsights"
    # value = "enabled"   # ←通常
    value = "enhanced" # ←強化
  }
}

resource "aws_ecs_service" "main" {
  name                   = "${var.project_name}-main-service"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.main.arn
  desired_count          = 1
  launch_type            = "FARGATE"
  enable_execute_command = true # これを追加

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # ★ ECS ネイティブ Blue/Green を有効化
  deployment_configuration {
    strategy = "BLUE_GREEN"
    # 任意：本番切替後に Blue を残す時間（ロールバック猶予）
    # 最小: 0分、最大: 10080分（7日間）
    bake_time_in_minutes = 5
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ネットワーク設定 (Private Subnetに配置)
  network_configuration {
    subnets          = [local.private_subnet_a_id, local.private_subnet_c_id]
    security_groups  = [aws_security_group.ecs_sg.id]
    assign_public_ip = false # Private配置＋NAT利用なのでFalse
  }

  # ALBとの紐付け
  load_balancer {
    target_group_arn = aws_lb_target_group.slot_a.arn
    container_name   = "nginx-container"
    container_port   = 80

    # ★ Blue/Green 用の追加設定
    advanced_configuration {
      alternate_target_group_arn = aws_lb_target_group.slot_b.arn
      production_listener_rule   = aws_lb_listener_rule.ecs_production.arn
      test_listener_rule         = aws_lb_listener_rule.ecs_test.arn # 任意（不要なら消してOK）
      role_arn                   = module.ecs_infra_lb.arn
    }
  }

  lifecycle {
    # GitHub Actions 側でタスク定義を更新している場合、その変更を Terraform の管理外にする
    ignore_changes = [
      task_definition,
      desired_count # オートスケーリングを使うなら追加
    ]
  }

}

resource "aws_ecs_task_definition" "main" {
  family                   = "${var.project_name}-main-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  # cpu                      = "256" # 0.25 vCPU
  # memory                   = "512" # 0.5 GiB
  # cpu    = "512"  # 0.5 vCPU
  # memory = "1024" # 1 GiB
  cpu    = "1024" # 1 vCPU
  memory = "2048" # 2 GiB
  # cpu    = "2048" # 2 vCPU
  # memory = "4096" # 4 GiB

  execution_role_arn = module.ecs_task_execution_role.arn
  task_role_arn      = module.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "nginx-container"
      image = "${data.aws_ssm_parameter.ecr_repo_url_nginx.value}:${var.image_tag}"
      portMappings = [
        {
          containerPort = 80
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awsfirelens"
        options = {
          Name              = "cloudwatch_logs"
          region            = "ap-northeast-1"
          log_group_name    = aws_cloudwatch_log_group.ecs_log.name
          log_stream_prefix = "nginx/"
          # auto_create_group = "true" # <- 既に作るなら不要（権限トラブルも減る）
        }
      }
    },
    {
      name  = "backend-container"
      image = "${data.aws_ssm_parameter.ecr_repo_url_backend.value}:${var.image_tag}"
      portMappings = [
        {
          containerPort = 9000
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "FRONTEND_URL", value = "https://${var.sub_frontend_domain_name}.${var.domain_name}" },
        { name = "DB_DATABASE", value = "${aws_db_instance.main.db_name}" },
        { name = "DB_HOST", value = "${aws_db_instance.main.address}" },
        { name = "DB_PORT", value = "3306" },
        { name = "DB_USERNAME", value = "${var.db_username}" },
        { name = "DB_CONNECTION", value = "mysql" },
        { name = "LOG_CHANNEL", value = "stderr" },
        { name = "LOG_DEPRECATIONS_CHANNEL", value = "stderr" },
        { name = "APP_URL", value = "https://${var.sub_backend_domain_name}.${var.domain_name}" },
        { name = "AWS_DEFAULT_REGION", value = "ap-northeast-1" },
        { name = "AWS_BUCKET", value = "${aws_s3_bucket.image_bucket.bucket}" },
        # ★ CloudFrontのURLを設定
        { name = "AWS_URL", value = "https://${aws_cloudfront_distribution.image_cdn.domain_name}" },
        { name = "AWS_USE_PATH_STYLE_ENDPOINT", value = "false" },
        { name = "APP_NAME", value = "Kum" },
        { name = "APP_ENV", value = "${var.app_env}" },
        { name = "APP_DEBUG", value = "false" },
        # # 【追加推奨】これがないとデフォルトのlocalドライバが使われてしまいます
        { name = "FILESYSTEM_DISK", value = "s3" },
        #承認済みのリダイレクトURI」をCloudFront経由のURLに変更 google consoleにも追加するのを忘れないように
        { name = "GOOGLE_REDIRECT_URI", value = "https://${var.sub_frontend_domain_name}.${var.domain_name}/api/auth/google/callback" },
        # { name = "GOOGLE_REDIRECT_URI", value = "https://${var.sub_backend_domain_name}.${var.domain_name}/api/auth/google/callback" },
        { name = "SESSION_DRIVER", value = "database" },
        { name = "SESSION_LIFETIME", value = "120" },
        { name = "SESSION_ENCRYPT", value = "false" },
        { name = "SESSION_PATH", value = "/" },
        { name = "SESSION_SECURE", value = "true" },
        { name = "SESSION_SAME_SITE", value = "lax" },
        //kumはSERVER_URLがフロントエンド経由(https://www.example.com/api)のURLでだったから必要なかった
        # { name = "SESSION_DOMAIN", value = ".${var.domain_name}" },
        { name = "MAIL_MAILER", value = "ses" },
        { name = "MAIL_FROM_ADDRESS", value = "noreply@${var.sub_frontend_domain_name}.${var.domain_name}" },
        { name = "MAIL_FROM_NAME", value = "${var.project_name}" },
        # SQS キュー設定
        { name = "QUEUE_CONNECTION", value = "sqs" },
        { name = "SQS_PREFIX", value = "https://sqs.ap-northeast-1.amazonaws.com/${data.aws_caller_identity.current.account_id}" },
        { name = "SQS_QUEUE", value = "${var.app_env}-qrcode-generation" },
        { name = "OTEL_PHP_AUTOLOAD_ENABLED", value = "true" },
        { name = "OTEL_SERVICE_NAME", value = "${var.project_name}-backend" },
        { name = "OTEL_TRACES_EXPORTER", value = "otlp" },
        { name = "OTEL_EXPORTER_OTLP_PROTOCOL", value = "http/protobuf" },
        { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = "http://localhost:4318" },
        { name = "OTEL_PROPAGATORS", value = "baggage,tracecontext" },
      ]

      secrets = [
        { name = "DB_PASSWORD", valueFrom = "${data.aws_ssm_parameter.db_password.arn}" },
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${data.aws_ssm_parameter.google_client_id.arn}" },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${data.aws_ssm_parameter.google_client_secret.arn}" },
        { name = "APP_KEY", valueFrom = "${data.aws_ssm_parameter.app_key.arn}" },
      ]

      logConfiguration = {
        logDriver = "awsfirelens"
        options = {
          Name              = "cloudwatch_logs"
          region            = "ap-northeast-1"
          log_group_name    = aws_cloudwatch_log_group.ecs_log.name
          log_stream_prefix = "backend/"
          # auto_create_group = "true" # <- 既に作るなら不要（権限トラブルも減る）
        }
      }
    },
    {
      name      = "log-router"
      image     = "public.ecr.aws/aws-observability/aws-for-fluent-bit:stable"
      essential = true

      firelensConfiguration = {
        type = "fluentbit"
        options = {
          #ログの"中身（レコード）に ECS メタデータを付与する"　例： task ARN / cluster / container 名など デフォルトで true 相当
          "enable-ecs-log-metadata" = "true"
        }
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_log.name
          "awslogs-region"        = "ap-northeast-1"
          "awslogs-stream-prefix" = "firelens"
        }
      }
    },
    {
      name      = "adot-collector"
      image     = "public.ecr.aws/aws-observability/aws-otel-collector:latest"
      essential = false

      portMappings = [
        { containerPort = 4317, protocol = "tcp" },
        { containerPort = 4318, protocol = "tcp" }
      ]

      # SSM Parameter の内容を AOT_CONFIG_CONTENT として渡す（ECSは "secrets" で注入）
      secrets = [
        { name = "AOT_CONFIG_CONTENT", valueFrom = aws_ssm_parameter.otel_collector_config.arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_log.name
          "awslogs-region"        = "ap-northeast-1"
          "awslogs-stream-prefix" = "adot"
        }
      }
    }
  ])
}

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = 6
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.main.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.project_name}-cpu-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "memory" {
  name               = "${var.project_name}-memory-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 70  # 例: 平均メモリ使用率70%を維持
    scale_in_cooldown  = 180 # 例: メモリは下がりにくいので少し長めでもOK
    scale_out_cooldown = 60
  }
}
