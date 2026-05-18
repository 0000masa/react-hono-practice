# ステージング環境 月額コスト見積もり

`terraform/stg` から展開される `terraform/modules/app-infrastructure` の構成を対象に、東京リージョン (ap-northeast-1) の **On-Demand 公開価格** を用いて月額コストを概算する。

> - 対象: `terraform.tfvars` のステージング値 (`rds_instance_class = db.t4g.micro` / `rds_multi_az = false` / `enable_nat_gateway = true` デフォルト)
> - 前提: 1 か月 = 730 時間。税抜・USD。無料利用枠はアカウント全体で他用途に使われていない想定で控除。
> - 価格は 2026 年時点の公開価格を参照した概算で、実際の請求額はトラフィックや為替で変動する。
> - 本書は新規デプロイのためではなく、**既に適用されている Terraform 構成** のランニングコスト把握を目的とする。

## 1. サマリ

| 分類 | 金額 (USD/月) | 備考 |
| --- | ---: | --- |
| **常時起動コスト (fix)** | **約 $104** | インスタンス・Proxy・NAT・WAF など稼働有無に関わらず発生 |
| **使用量課金 (variable)** | **約 $3〜8** | Lambda / CloudFront / ログ / API Gateway — トラフィック依存 |
| **合計目安** | **約 $107〜$112 / 月** | 約 **16,000〜17,000 円 / 月** (1 USD = 150 円換算) |

> ステージング想定のトラフィック (リクエスト数千〜1 万/月、CloudFront 配信数 GB 規模) を前提にした概算。実運用トラフィックが跳ねれば CloudFront / Lambda / NAT 処理料金が線形に増える。

## 2. リソース別 内訳

### 2.1 コストの大半を占めるトップ 4

| # | サービス | 月額 | 内訳 |
| --- | --- | ---: | --- |
| 1 | **NAT Gateway** | **約 $45.3** | $0.062/時 × 730h = $45.26 + データ処理 $0.062/GB。single_nat_gateway=true で 1 台。|
| 2 | **RDS Proxy** | **約 $26.3** | $0.018/vCPU-時 × 2 vCPU (db.t4g.micro に対する最低 2 vCPU 分) × 730h。|
| 3 | **RDS (db.t4g.micro, Single-AZ)** | **約 $21.8** | インスタンス $0.026/h × 730h = $18.98 + gp3 20GB ($0.138/GB) = $2.76 + バックアップ 20GB (割当量以下で無料)。|
| 4 | **WAF (CloudFront scope)** | **約 $7.0** | Web ACL $5.00 + Managed Rule Group (CommonRuleSet) $1.00 + リクエスト $0.60/百万。|

この 4 つで **約 $100 / 月**。コスト削減を検討する場合、最初の着目点はここ。

### 2.2 恒常稼働する小額リソース

| サービス | 月額 | 内訳 |
| --- | ---: | --- |
| EC2 踏み台 (t4g.nano + gp3 8GB) | 約 $4.7 | インスタンス $0.0054/h × 730h = $3.94 + EBS gp3 $0.096/GB × 8GB = $0.77 |
| CloudFront (2 ディストリビューション) | 約 $1.5 | 転送料 $0.114/GB + 日本エッジ HTTPS $0.009/1 万リクエスト (5GB + 5 万 req 想定) |
| CloudWatch Logs (Lambda×4 + API GW) | 約 $1.5 | 取込 $0.76/GB、保存 $0.033/GB・月、保持 30 日 |
| Lambda (5 関数) | 約 $1.0 | $0.20/100 万リクエスト + $0.0000166667/GB・秒。stg トラフィックだと無料枠にほぼ収まる |
| Route53 ホストゾーン | $0.50 | 既存ゾーン (data source 参照)。クエリ数は概ね無料枠 |
| Secrets Manager | $0.40 | シークレット 1 個。30 日ローテーション (Lambda 起動は月 1 回) |
| CloudWatch Metric Alarm × 2 | $0.20 | `lambda_api_errors` / `lambda_api_throttles` |
| API Gateway (REST Regional) | <$0.10 | $4.25/100 万リクエスト。stg リクエスト数ではほぼゼロ |
| S3 (2 バケット) | <$0.10 | Standard $0.025/GB・月。数 GB 規模 |
| SQS Standard | $0.00 | 月 100 万リクエストまで無料 |
| SNS (email) | $0.00 | 月 1,000 通まで無料 |
| SES | $0.00 | Lambda/EC2 からの送信は月 62,000 通まで無料 |
| EventBridge (daily) | $0.00 | スケジュール起動 30 回/月 × $1/100 万 = 無視可 |
| S3 Gateway Endpoint | **$0.00** | Gateway 型は無料 |
| VPC / サブネット / SG | **$0.00** | VPC 本体は無料 |
| ACM (CloudFront, us-east-1) | **$0.00** | パブリック証明書は無料 |

## 3. 見落としがちなコスト要因

### NAT Gateway が最大のコスト
- `enable_nat_gateway = true` (stg の variables 既定値) で 1 台常時稼働。
- Lambda は VPC 内 (`private_subnets`) に配置されているため、SES / Secrets Manager / S3 以外への外向き通信 (外部 API、ECR Public 等) は NAT 経由 = **時間単価 $45/月に加え、データ処理 $0.062/GB** が発生。
- **S3 Gateway Endpoint** は既に配置済みで S3 通信のコスト増は避けている (GOOD)。
- 機能検証のみで夜間止めたい場合は `enable_nat_gateway = false` に切替える案があるが、その場合 Lambda から外部到達が必要な経路 (ECR Image pull は VPC Endpoint 経由・SES・CloudWatch 等) の代替を検討する必要がある。

### RDS Proxy のミニマム課金
- `aws_db_proxy` は **アタッチ先 DB の vCPU 最小 2** で課金される。`db.t4g.micro` (2 vCPU) に対しても固定 2 vCPU 分発生。
- Lambda からの同時接続集約目的で入れているため停止しづらいが、停止できるなら $26/月が消える。

### WAF の固定費
- CloudFront 向け WAF は利用有無に関わらず Web ACL $5 + Rule $1 が発生。ステージングで WAF 防御が必須でないなら Web ACL を外すと $6/月削減。

### CloudWatch Logs 保持 30 日
- `retention_in_days = 30` が Lambda 4 本 + API GW で設定済み。取込量が少ないうちは $1〜2/月で収まるが、ログ量が増えるとここは急伸する。長期保管不要なら 7〜14 日へ短縮可能。

### データ転送 (アウトバウンド)
- CloudFront → ビューワ: 上記 CloudFront 料金に含まれる。
- Lambda/EC2 → インターネット (NAT 経由): 処理料金 $0.062/GB は NAT Gateway 行に計上済み。
- AZ 間転送: RDS は Single-AZ かつ Lambda/Proxy も同一 VPC 内で設計的には多くない想定。

## 4. コスト削減オプション (ステージング向け)

優先度順の概算インパクト。

| 案 | 月額削減 | 備考 |
| --- | ---: | --- |
| **NAT Gateway を夜間/週末停止** (例: 平日 10h 稼働に限定) | 約 $30 | `enable_nat_gateway` を Terraform 外から起動/停止するスクリプトで運用。Lambda の外部通信断が発生して良いタイミングに限る。 |
| **RDS Proxy を外す** | 約 $26 | Lambda から直接 RDS 接続へ切替。stg の同時実行数が低ければ現実的。IAM 認証も Proxy 前提なのでアプリ側改修要。 |
| **WAF を外す** | 約 $6 | stg で WAF 保護が不要であれば削除。本番では残す。 |
| **踏み台 EC2 を普段止める** | 約 $4 | 使うときだけ `terraform apply -target` もしくは手動 start/stop。SSM Session Manager 経由なので再開は容易。 |
| **ロググループ保持を 14 日へ短縮** | 数 $ | ログ量次第。 |

全部実施すると約 **$60/月** 削減で、最小構成時の月額は **約 $45〜$50** 程度まで落ちる (RDS + 最低限の CloudFront/Route53/Secrets)。

## 5. 前提と免責

- 価格は ap-northeast-1 の **On-Demand 公開価格** を参照した机上見積もり。Savings Plans / Reserved Instance 未適用。
- トラフィックが想定より多いケース (CloudFront 数十 GB/月、API 数十万リクエスト、外部 API 叩きで NAT データ多量通過) では使用量課金が跳ねる。
- `variable "enable_nat_gateway"` の既定値は `true`。明示的に `false` にすると NAT Gateway が消えて最大の削減になるが、Lambda からの外部到達が前提の機能 (例: Google OAuth、外部 API コール) は追加対処が要る。
- 本番 (`rds_multi_az = true` / `rds_instance_class` 引き上げ / `rds_monitoring_interval > 0` / Performance Insights 有効) へ切り替えると、**RDS 関連だけで月額が 2〜3 倍** になる点に注意。
- 最新・正確な価格は AWS Pricing Calculator もしくは AWS コンソール上の Billing で要確認。
