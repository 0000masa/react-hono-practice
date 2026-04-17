# RDS 本番 / ステージング環境別設定ガイド

AWS 公式ドキュメント・AWS Well-Architected Framework・AWS Control Tower / Security Hub のベストプラクティスに基づき、本番環境（production）とステージング環境（staging）で **RDS の設定を環境別にどう分けるべきか** をまとめる。

> 出典:
> - [Resilience in Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/disaster-recovery-resiliency.html)
> - [Introduction to backups - Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
> - [Settings for DB instances - Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.Settings.html)
> - [Amazon RDS controls - AWS Control Tower](https://docs.aws.amazon.com/controltower/latest/controlreference/rds-rules.html)
> - [Security Hub CSPM controls for RDS](https://docs.aws.amazon.com/securityhub/latest/userguide/rds-controls.html)
> - [Long-term backup options for RDS and Aurora](https://aws.amazon.com/blogs/database/long-term-backup-options-for-amazon-rds-and-amazon-aurora/)

---

> **TL;DR** = "Too Long; Didn't Read"（長すぎて読まなかった）の略。長文の冒頭に置く「要約」「結論だけ知りたい人向けのまとめ」を意味するインターネット由来の慣用表現。

## TL;DR — 推奨設定一覧

「Terraform デフォルト」列は `aws_db_instance` リソースで該当属性を **指定しなかった場合に適用される値** を示す。

| 設定項目 | 概要（何を設定するか） | Terraform デフォルト | ステージング | 本番 | 備考 |
|---|---|---|---|---|---|
| `multi_az` | スタンバイDBを別AZに配置するか。`true`で同期レプリケーション + 自動フェイルオーバーが有効化される | `false` | `false` | **`true`** | 本番は単一AZ障害でのDB停止を防ぐため必須 |
| `backup_retention_period` | 自動バックアップの保持日数（0〜35）。この日数分のPITR（任意時点復元）が可能 | `0`（自動バックアップ無効）※AWS API側で `1` に補正される場合あり | `1〜3` 日 | **`14〜35` 日** | ステージングは短く、本番は最低14日 |
| `deletion_protection` | DBインスタンスの削除保護。`true`にすると、この設定をfalseに戻すまでDBを削除できなくなる | `false` | `false` | **`true`** | 本番は誤削除防止必須 |
| `skip_final_snapshot` | DB削除時に最終スナップショットを取得するかをスキップするか。`false`にすると削除直前のデータがスナップショットとして残る | `false`（= 最終スナップショット取得） | `true` | **`false`** | `false`時は `final_snapshot_identifier` 指定必須 |
| `instance_class` | DBインスタンスの計算リソース（CPU/メモリ）スペック。`db.t4g.micro` から `db.r6g.16xlarge` まで多数の選択肢あり | **必須**（デフォルトなし） | `db.t4g.micro` | `db.t4g.medium` 以上 | 本番は実負荷に応じて選定 |
| `allocated_storage` | **初期割り当てストレージ容量（GB）**。この値分が常時課金される（実使用量ではなく確保量に対して課金） | **必須**（デフォルトなし） | `20` GB | `100` GB 以上 | 本番は将来の増加を見込む |
| `max_allocated_storage` | **Storage Autoscalingの拡張上限（GB）**。`allocated_storage`が枯渇しそうになると自動拡張される。設定値自体には課金されず、実際に拡張された分のみ課金 | `0`（自動拡張無効） | `0`（無効） | `500` 以上 | 大きめに設定しても料金は増えない（保険として推奨） |
| `storage_type` | ストレージ種別。`gp2`/`gp3`（汎用SSD）、`io1`/`io2`（プロビジョンドIOPS）、`magnetic`（旧世代HDD） | `gp2`（`io1`/`io2` 指定時を除く） | `gp3` | `gp3` または `io2` | `gp3` の方がコスト効率良 |
| `performance_insights_enabled` | Performance Insights（DB性能可視化ツール）の有効化。スロークエリ・ロック待ち・トップSQLが可視化される | `false` | `false`（任意） | **`true`** | 本番は性能トラブルシュート用に必須 |
| `monitoring_interval` | Enhanced Monitoringのメトリクス取得間隔（秒）。`0`/`1`/`5`/`10`/`15`/`30`/`60`から選択。OS層のCPU・メモリ・プロセス情報をCloudWatchに送信 | `0`（Enhanced Monitoring 無効） | `0`（無効） | `60` 秒 | 本番で有効化 |
| `auto_minor_version_upgrade` | DBエンジンのマイナーバージョン自動アップグレード。セキュリティパッチが自動適用される | `true` | `true` | `true` | 両方で有効（セキュリティパッチ） |
| `apply_immediately` | 設定変更を即座に適用するか。`false`にするとメンテナンスウィンドウまで反映が遅延される | `false` | `true` | **`false`** | 本番でtrueは予期しないダウンタイムの原因になる |
| `enabled_cloudwatch_logs_exports` | CloudWatch Logsへエクスポートするログ種別の配列。`error`/`slowquery`/`general`/`audit`から選択 | `null`（無効） | `["error"]` | `["error", "slowquery", "general"]` | 本番は監査・分析のため広めに |
| `storage_encrypted` | 保管時暗号化（AES-256）の有効化。データ・自動バックアップ・スナップショット・ログ全てが暗号化される | `false` | `true` | `true` | 両方で必須（後から変更不可） |
| `publicly_accessible` | DBインスタンスにパブリックIPを割り当てインターネットから直接接続可能にするか | `false` | `false` | `false` | 両方で必須（VPC内のみアクセス） |
| `copy_tags_to_snapshot` | DBインスタンスのタグをスナップショットに自動コピーするか。コスト管理・棚卸しに必要 | `false` | `true` | `true` | スナップショット管理のため有効化 |
| `iam_database_authentication_enabled` | IAM認証によるDB接続を有効化。DBユーザーパスワード不要でIAMトークンで接続可能 | `false` | `true` | `true` | RDS Proxy + IAM認証で対応済 |
| `backup_window` | 自動バックアップを実行する時間帯（UTC、30分単位）。`hh:mm-hh:mm`形式 | AWSが自動選択 | `"17:00-17:30"` UTC | 業務時間外（例: JST 02:00-02:30 = UTC 17:00-17:30） | I/O負荷が増えるため業務時間外に設定 |
| `maintenance_window` | OS/エンジンパッチを適用する時間帯（UTC、30分単位）。`ddd:hh:mm-ddd:hh:mm`形式 | AWSが自動選択 | `"sun:15:00-sun:15:30"` | 業務時間外 | 再起動を伴うため業務時間外に設定 |

---

## 1. 環境別の設定方針（基本思想）

### ステージング環境のゴール
- **コスト最小化**：本番の 1/3〜1/5 のコスト目標
- **本番に近い構成**：エンジン・パラメータグループは本番と同一（互換性検証のため）
- **データの可塑性**：壊れても復旧時間より「作り直し」を優先

### 本番環境のゴール
- **可用性 99.95% 以上**：単一AZ障害で停止しない
- **データ保護**：誤削除・誤更新からの復旧手段を担保
- **観測性**：性能劣化を即座に検知できる
- **コンプライアンス**：暗号化・監査ログ要件を満たす

---

## 2. 各設定項目の詳細

### 2-1. `multi_az`（Multi-AZ 配置）

| 環境 | 推奨値 | 理由 |
|---|---|---|
| ステージング | `false` | コスト2倍に見合う可用性要件がない |
| 本番 | **`true`** | AZ障害時に1〜2分で自動フェイルオーバー、データ損失なし（同期レプリケーション） |

**Multi-AZ の動作**（[公式ドキュメント](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)より）:
- スタンバイDBが別AZに同期レプリケーションで配置される
- スタンバイは読み取りには使えない（純粋なフェイルオーバー用）
- 自動バックアップはスタンバイから取得されるため、プライマリへの I/O 影響が最小化される
- フェイルオーバーは自動（AZ障害・OS パッチ・インスタンス障害時）

**コスト影響**: インスタンス料金が約 **2倍**、ストレージ料金も2倍。

### 2-2. `backup_retention_period`（自動バックアップ保持日数）

| 環境 | 推奨値 | 理由 |
|---|---|---|
| ステージング | `1〜3` 日 | 直近の検証データを戻せれば十分。コスト削減 |
| 本番（一般Web） | **`14` 日** | 1〜2週間前の論理破壊・運用ミスに対応可能 |
| 本番（厳格） | **`30〜35` 日**（最大） | 監査・コンプライアンス要件がある場合 |

**仕様**（[公式ドキュメント](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)より）:
- 設定可能範囲: **0〜35 日**
- `0` を指定すると **自動バックアップ無効 = PITR不可**
- 設定値そのまま PITR（Point-In-Time Recovery）の遡れる範囲になる
- スナップショットは S3 に保存され、最初は完全、以降は増分
- DB割当ストレージサイズ以下のバックアップは無料、超過分は $0.095/GB/月（東京）

**35日を超える長期保持が必要なら**:
- AWS Backup の Vault Lock で年単位保持
- 手動スナップショット（削除されない限り保持）
- スナップショットを S3 にエクスポート（Parquet形式、Athena分析可能）

### 2-3. `deletion_protection`（削除保護）

| 環境 | 推奨値 | 理由 |
|---|---|---|
| ステージング | `false` | Terraform で頻繁に作り直す可能性がある |
| 本番 | **`true`** | コンソールやCLIからの誤削除を防ぐ |

AWS Control Tower / Security Hub いずれも本番DBには **必須コントロール** として推奨。`true` の場合、削除前にこの設定を `false` に変更する必要があり、誤操作の防壁となる。

### 2-4. `skip_final_snapshot`（削除時の最終スナップショット）

| 環境 | 推奨値 | 理由 |
|---|---|---|
| ステージング | `true` | スナップショット不要、削除を高速化 |
| 本番 | **`false`** | 削除直前のデータを保全、復旧の最後の砦 |

`false` の場合は `final_snapshot_identifier` の指定も必要。

### 2-5. `instance_class`（インスタンスクラス）

| 環境 | 推奨値 | 理由 |
|---|---|---|
| ステージング | `db.t4g.micro` / `db.t4g.small` | バーストCPUで十分、最安クラス |
| 本番 | `db.t4g.medium` 以上 / `db.m6g.large` 以上 | 本番ワークロードでは継続的なCPU性能が必要 |

**選定指針**:
- バースト型（`t` 系）は CPU クレジットが枯渇すると性能が劇的に低下するため、**本番の常時稼働には m 系・r 系を推奨**
- ARM ベース（`g` サフィックス、Graviton）は x86 比で 20〜35% コスト効率が良い
- 現在の構成は `db.t4g.micro`（コメントアウトで `db.t4g.medium` の選択肢あり）

### 2-6. `allocated_storage` と `storage_type`

| 環境 | `allocated_storage` | `storage_type` |
|---|---|---|
| ステージング | `20` GB | `gp3` |
| 本番 | `100` GB 以上 | `gp3` または `io2`（高IOPS要件時） |

**ストレージタイプの選び方**:
- `gp3`: 汎用SSD、コスト効率が良くベースライン 3,000 IOPS。**ほとんどのワークロードで第一候補**
- `io2`: プロビジョンドIOPS、99.999% の耐久性。月数百GB以上 + 高頻度書き込み時のみ
- `gp2`: 旧世代、`gp3` より割高なため新規利用は非推奨

**Storage Autoscaling**:
- `max_allocated_storage` を設定すると自動拡張される（縮小は不可）
- 本番では必ず設定し、急激なデータ増加でDB停止する事故を防ぐ

### 2-7. `performance_insights_enabled` と `monitoring_interval`

| 環境 | Performance Insights | Enhanced Monitoring |
|---|---|---|
| ステージング | `false` | `0`（無効） |
| 本番 | **`true`** | `60` 秒 |

**Performance Insights**:
- **直近7日間は無料**、長期保持（最大2年）は有料
- スロークエリ・ロック待ち・トップSQLが可視化される
- 本番の性能トラブルは Performance Insights が無いと原因特定がほぼ不可能

**Enhanced Monitoring**:
- OS レベルのメトリクス（プロセス、ディスクIO、ネットワーク）を CloudWatch に送信
- インターバルが短いほど課金が増える（`60` 秒なら月数ドル程度）
- AWS Trusted Advisor の Operational Excellence チェック項目

### 2-8. `apply_immediately`（変更の即時適用）

| 環境 | 推奨値 | 理由 |
|---|---|---|
| ステージング | `true` | 検証を素早く回したい |
| 本番 | **`false`** | メンテナンスウィンドウまで待ち、計画停止のみで反映 |

**注意**: パラメータグループの変更や `instance_class` 変更は再起動を伴う。本番で `apply_immediately = true` のまま `instance_class` を変えると **即座にダウンタイム** が発生する。

### 2-9. `enabled_cloudwatch_logs_exports`

| 環境 | 推奨値 |
|---|---|
| ステージング | `["error"]` |
| 本番 | `["error", "slowquery", "general", "audit"]` |

- `error`: エラーログ（必須）
- `slowquery`: スロークエリログ（パフォーマンス分析）
- `general`: 全クエリ（容量大、監査要件があれば）
- `audit`: 監査ログ（プラグイン要、コンプライアンス用）

ログ容量に応じて CloudWatch Logs の課金が増えるため、本番でも要件に応じて選択。

### 2-10. `storage_encrypted`（保管時暗号化）

両環境で **`true` 必須**。後から変更不可（スナップショットからの復元が必要）。Security Hub / Control Tower の必須コントロール。

### 2-11. その他の本番推奨設定（共通で有効化済 or 検討項目）

| 設定 | 推奨 | 現状 |
|---|---|---|
| `publicly_accessible` | `false`（必須） | ✅ 設定済 |
| `auto_minor_version_upgrade` | `true` | ✅ 設定済 |
| `iam_database_authentication_enabled` | `true` | ✅ RDS Proxy + IAM 認証で対応済 |
| `copy_tags_to_snapshot` | `true` | ✅ 設定済 |
| `monitoring_role_arn` | Enhanced Monitoring 用 IAM ロール | 未設定（本番で追加検討） |
| `parameter_group_name` | カスタムパラメータグループ | デフォルト使用中 |

---

## 3. 推奨 Terraform 構成

### 3-1. 環境別変数の追加（実装済）

`modules/app-infrastructure/variables.tf`:

```hcl
variable "rds_multi_az" {
  description = "RDSをMulti-AZ構成にするかどうか（本番true推奨）"
  type        = bool
  default     = false
}

variable "rds_backup_retention_period" {
  description = "RDS自動バックアップの保持日数（0〜35）"
  type        = number
  default     = 7

  validation {
    condition     = var.rds_backup_retention_period >= 0 && var.rds_backup_retention_period <= 35
    error_message = "backup_retention_period は 0〜35 の範囲で指定してください。"
  }
}
```

### 3-2. ステージング環境の設定値

`stg/terraform.tfvars`:

```hcl
# --- RDS（ステージング設定） ---
rds_multi_az                = false
rds_backup_retention_period = 3
```

### 3-3. 本番環境を追加する場合（将来的な拡張）

`prod/terraform.tfvars`（新規作成想定）:

```hcl
# --- RDS（本番設定） ---
rds_multi_az                = true
rds_backup_retention_period = 14
# 以下は将来 variables.tf に追加すべき項目
# rds_instance_class            = "db.m6g.large"
# rds_allocated_storage         = 100
# rds_max_allocated_storage     = 500
# rds_deletion_protection       = true
# rds_skip_final_snapshot       = false
# rds_apply_immediately         = false
# rds_performance_insights      = true
# rds_monitoring_interval       = 60
# rds_cloudwatch_logs_exports   = ["error", "slowquery"]
```

---

## 4. ステージングから本番へ昇格する際のチェックリスト

ステージング環境で動作確認後、本番環境を構築する際は以下を必ず確認する：

- [ ] `multi_az = true` を設定
- [ ] `backup_retention_period >= 14`
- [ ] `deletion_protection = true`
- [ ] `skip_final_snapshot = false` + `final_snapshot_identifier` 指定
- [ ] `apply_immediately = false`（メンテナンスウィンドウで反映）
- [ ] `instance_class` を本番ワークロード相当に変更（最低 `db.t4g.medium`）
- [ ] `allocated_storage` を増加 + `max_allocated_storage` 設定
- [ ] `performance_insights_enabled = true`
- [ ] `monitoring_interval = 60` + Enhanced Monitoring 用 IAM ロール
- [ ] `enabled_cloudwatch_logs_exports` にスロークエリを追加
- [ ] CloudWatch アラーム設定（CPU、接続数、ストレージ残量、レプリカラグ）
- [ ] バックアップウィンドウとメンテナンスウィンドウが業務時間外であること
- [ ] AWS Backup でクロスリージョンバックアップを検討（DR要件次第）

---

## 5. コスト試算（参考、東京リージョン）

`db.t4g.micro` ベースで試算：

| 項目 | ステージング（現状） | 本番（推奨） |
|---|---|---|
| インスタンス（`db.t4g.micro` × Single-AZ） | $13/月 | - |
| インスタンス（`db.t4g.medium` × Multi-AZ） | - | $122/月 |
| ストレージ（`gp3` 20GB） | $2.4/月 | - |
| ストレージ（`gp3` 100GB × Multi-AZ） | - | $24/月 |
| バックアップ（保持3日、変更率5%） | ほぼ$0 | - |
| バックアップ（保持14日、100GB DB） | - | 約$5/月 |
| Performance Insights（7日無料枠） | $0 | $0 |
| Enhanced Monitoring（60秒間隔） | $0 | 約$2/月 |
| **合計目安** | **約$15/月** | **約$153/月** |

本番が約10倍のコストになるが、可用性・観測性・データ保護の観点で必要なコストである。

---

## 6. 参考: AWS Well-Architected Framework での位置づけ

- **REL13-BP02 Use defined recovery strategies**: Multi-AZ は「near DR（in-Region DR）」に該当。RTO/RPO がより厳しい場合はクロスリージョン Read Replica を検討
- **REL09 Back up data**: 自動バックアップ + PITR は最小要件。長期保持は AWS Backup
- **SEC08 Protect data at rest**: `storage_encrypted = true` は必須
- **OPS04 Implement observability**: Performance Insights + Enhanced Monitoring + CloudWatch Logs

---

## 7. まとめ

このプロジェクトの現状（ステージングのみ）では、以下の最小変更で本番準備が整う：

1. ✅ `multi_az` を変数化（実装済）
2. ✅ `backup_retention_period` を変数化（実装済）
3. ⏳ 本番環境用ディレクトリ（`terraform/prod/`）の追加
4. ⏳ `deletion_protection`、`instance_class`、`performance_insights_enabled` 等の追加変数化
5. ⏳ CloudWatch アラーム（CPU、接続数、ストレージ残量、レプリカラグ）の設定

ステージングは現状のままコスト最適化を維持し、本番ではこのドキュメントの推奨値を適用することで、可用性・コストのバランスが取れた RDS 運用が可能になる。
