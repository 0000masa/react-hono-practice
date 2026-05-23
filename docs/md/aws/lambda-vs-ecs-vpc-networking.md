# Lambda と ECS の VPC ネットワーク経路比較

## 概要

VPC 内に配置した Lambda 関数と ECS タスクから AWS 各種サービス（ECR、CloudWatch Logs、Secrets Manager / SSM、SQS、S3）にアクセスするとき、**VPC エンドポイントを使わない場合に NAT Gateway → Internet Gateway を経由するかどうか**は両者で大きく異なる。

この違いは Lambda が「マネージドな実行環境」であるのに対し、ECS（特に Fargate）は「VPC 内にコンテナを直接動かす」思想であることに起因する。

---

## 1. 前提の整理: 誰がその通信を行うか

Lambda と ECS でネットワーク経路が変わる本質的な理由は、**通信の主体がどこにいるか**である。

| 通信の種類 | Lambda | ECS (Fargate) |
| --- | --- | --- |
| サービス側（AWS 管理インフラ）が代行 | VPC を経由しない | — |
| タスク / 関数のコードが実行 | タスク ENI を経由 | タスク ENI を経由 |
| コンテナ起動前の基盤処理（image pull 等） | サービス側が代行 | **タスク ENI を経由** |

Lambda では「サービス側が代行する範囲」が広いため、VPC 設定の影響を受けない通信が多い。ECS Fargate では基盤処理もタスク ENI を使うため、private subnet 配置時はほぼすべての通信が NAT Gateway または VPC エンドポイントを必要とする。

---

## 2. サービス別の比較

NAT Gateway（以下 NAT GW）を使わない構成にするには、対応する VPC エンドポイントを配置する必要がある。下表の「NAT GW 経由」は **VPC エンドポイントがない場合に NAT GW → Internet Gateway を通るか** を表す。

| 通信 | Lambda (VPC 設定あり) | ECS Fargate (awsvpc / private subnet) |
| --- | --- | --- |
| ECR からのイメージ pull | ❌ NAT GW 不要（Lambda サービスがコントロールプレーンで実施しキャッシュ） | ✅ タスク ENI → NAT GW → IGW |
| CloudWatch Logs へのログ出力 | ❌ NAT GW 不要（Lambda ランタイムが stdout/stderr をキャプチャして送信） | ✅ `awslogs` ドライバがタスク ENI から送信 |
| Secrets Manager / SSM からの環境変数注入（起動時） | ❌ 該当処理なし（関数コードから呼ぶ場合のみ発生） | ✅ Fargate エージェントがタスク ENI から取得 |
| SQS トリガー（イベントソースマッピング / ポーリング） | ❌ NAT GW 不要（Lambda サービスがポーリング） | — （ECS に等価な仕組みはなし） |
| 関数 / タスクコードから SQS SendMessage | ✅ ENI → NAT GW → IGW | ✅ ENI → NAT GW → IGW |
| 関数 / タスクコードから S3 への PutObject | ✅ ENI → NAT GW → IGW | ✅ ENI → NAT GW → IGW |

凡例: ✅ = 経由する / ❌ = 経由しない

---

## 3. Lambda の場合

### 3.1 サービス側が代行する通信

以下は Lambda サービスのインフラ側で行われるため、**VPC 設定・NAT GW・Internet Gateway・VPC エンドポイントのいずれも経由しない**。

- **ECR からのコンテナイメージ pull**
  関数の作成・更新時に Lambda サービスが pull し、最適化したうえでキャッシュする。実行時には既にキャッシュ済みのイメージが使われるため、起動ごとの外部通信は発生しない。
- **CloudWatch Logs への出力**
  Lambda ランタイムが関数の stdout / stderr を取得し、サービス側経路で CloudWatch Logs に送る。関数が VPC 内にあっても関係ない。
- **SQS / Kinesis / DynamoDB Streams などのイベントソースマッピング**
  Lambda サービスがポーリングし、イベントとして関数を起動する。ポーリングは関数の ENI から行われるわけではない。
- **S3 に置かれたデプロイパッケージ（zip）の取得**
  こちらも Lambda サービス側で処理される。

### 3.2 関数コードからの通信

関数の中で AWS SDK や HTTP クライアントを明示的に呼び出すと、**関数に紐づく ENI から通信が出ていく**。

- `sqs.sendMessage()` / `s3.putObject()` / `dynamodb.putItem()` / `ssm.getParameter()` など
- 外部 API への HTTPS リクエスト

VPC エンドポイントを置いていない場合は、ENI → NAT GW → Internet Gateway を経由して AWS のパブリックエンドポイントに到達する。

---

## 4. ECS (Fargate) の場合

ECS Fargate は awsvpc モードでタスク自身が ENI を持ち、その ENI からほぼすべての通信が出ていく。「マネージド」な範囲は Lambda より狭い。

### 4.1 タスク ENI を経由する通信

- **ECR からのイメージ pull**
  タスク起動時に Fargate エージェントがイメージを pull する。タスク ENI から ECR API / ECR Docker レジストリへ、さらに裏側の S3 にレイヤーを取りに行く通信が発生する。
- **CloudWatch Logs への出力**
  `awslogs` ドライバがタスク ENI 経由で CloudWatch Logs にログを送信する。
- **Secrets Manager / SSM からの環境変数注入**
  タスク定義の `secrets` で指定した値を、Fargate エージェントがタスク起動時に取得する。これもタスク ENI 経由。
- **タスクコードからの AWS SDK 呼び出し・外部 API 呼び出し**
  Lambda と同様に ENI → NAT GW → IGW 経路。

### 4.2 private subnet 配置時に必要な VPC エンドポイント

NAT Gateway を使わず ECR pull とログ出力を成立させるには、最低限以下が必要になる。

Interface 型エンドポイント:

- `com.amazonaws.<region>.ecr.api`
- `com.amazonaws.<region>.ecr.dkr`
- `com.amazonaws.<region>.logs`（CloudWatch Logs を使う場合）
- `com.amazonaws.<region>.secretsmanager`（Secrets Manager から値を注入する場合）
- `com.amazonaws.<region>.ssm`（SSM Parameter Store を使う場合）
- `com.amazonaws.<region>.sqs`（タスクから SQS を呼ぶ場合）

Gateway 型エンドポイント:

- `com.amazonaws.<region>.s3`
  - ECR のイメージレイヤー実体は S3 に置かれているため、**ECR pull を VPC エンドポイントだけで完結させるなら必須**。
  - タスクコードが S3 を直接使う場合も同じく必要。

### 4.3 ECS on EC2 との違い

ECS on EC2 では、イメージ pull やログ送信を実行するのは EC2 インスタンス上の ECS エージェント。経路は「EC2 インスタンスの ENI → NAT GW または VPC エンドポイント」になる。private subnet に置けば同様に NAT GW か VPC エンドポイントが必要、という構造は Fargate と同じ。

---

## 5. ネットワーク経路の図

### 5.1 Lambda（VPC 設定あり）

```
[Lambda サービス基盤]
    │
    ├── ECR pull（サービス側で実施、VPC を通らない）
    ├── CloudWatch Logs 送信（サービス側）
    └── SQS トリガー ポーリング（サービス側）

[Lambda 関数 ENI (private subnet)]
    │
    ├── 関数コード内の AWS SDK 呼び出し
    └── 外部 API 呼び出し
         │
         ▼
    [NAT GW] → [Internet Gateway] → インターネット / AWS パブリック endpoint
```

### 5.2 ECS Fargate（private subnet）

```
[タスク ENI (private subnet)]
    │
    ├── ECR pull（Fargate エージェント）
    ├── CloudWatch Logs 送信（awslogs ドライバ）
    ├── Secrets / SSM 取得（起動時）
    └── タスクコードからの AWS SDK / 外部 API 呼び出し
         │
         ▼
    [NAT GW] → [Internet Gateway] → インターネット / AWS パブリック endpoint
    ※ VPC エンドポイントを配置すればそちら経由に切り替わる
```

---

## 6. 設計上の示唆

- **Lambda は VPC 内に入れても、ログ・ECR・イベントソースのために NAT GW を用意する必要はない**。関数コードから外部・AWS API を叩く必要がなければ、NAT GW は不要になる可能性が高い。
- **ECS Fargate を private subnet に置く場合は、NAT GW か VPC エンドポイントのどちらかが必須**。エンドポイントが無いとイメージ pull の段階でタスクが起動できず、デバッグしづらい失敗になる。
- コスト観点では、トラフィック量が多いなら Interface Endpoint より NAT GW の方が安く済むケースもあり、小規模なら NAT GW 1 本で足りることが多い。用途に応じて選択する。
- Lambda と ECS の両方を使うシステムでは、**Lambda 都合で NAT GW を外したつもりが ECS タスクが死ぬ** という事故が起きやすい。どちらの実行基盤がどこを通るかを踏まえて VPC 設計すること。
