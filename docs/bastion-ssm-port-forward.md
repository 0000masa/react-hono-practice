# ローカル PC から SSM ポートフォワーディング経由で RDS に接続する

## 概要

RDS はプライベートサブネットに配置されており、通常の経路では Lambda 経由でしか触れない。開発中の調査や手動データ修正のため、**Session Manager のポートフォワーディング機能**で踏み台 EC2 を中継して RDS に接続する手順をまとめる。

SSH は使わず、踏み台には公開鍵も 22 番ポートも開けていない。すべて AWS API + IAM 認証でアクセスする。

```
ローカル PC                AWS
  │                         │
  │  aws ssm start-session  │   ssmmessages (TLS)
  │ ───────────────────────►│── ──────────────► Bastion EC2 (private subnet)
  │                         │                     │
  │                         │                     │ TCP 3306
  │ ◄── localhost:13306 ◄──── ─────────────────── ▼
  │         (mysql CLI)     │                   RDS (MySQL 8.4)
```

`localhost:13306` が踏み台経由で RDS の 3306 にそのまま転送される。ローカルの `mysql` コマンドは RDS を意識せず `-h 127.0.0.1` で接続する。

---

## なぜプライベートサブネットの踏み台に繋がるのか

「プライベートサブネット + パブリック IP 無し + inbound 許可無し」の踏み台にローカル PC からポートフォワーディングできるのは、Session Manager が **踏み台への inbound 接続を一切使わない**仕組みだからである。

### 通信の実体

踏み台 EC2 には **SSM Agent が常駐していて、起動直後から AWS の SSM エンドポイントへ outbound で TLS 接続を張りっぱなし**にしている。ポートフォワーディングは、この既存の outbound トンネル上にデータを流しているだけ。

```
ローカル PC                  AWS                        Bastion EC2 (private subnet)
                               │                          │
                               │  SSM Agent が起動時から   │
                               │  outbound で張り続ける    │
                               │  ←──────────────────────│  (ssm / ssmmessages / ec2messages)
                               │                          │
  (1) aws ssm start-session    │                          │
  ───────────────────────►    │                          │
                               │  (2) 既存トンネル経由で   │
                               │  「port-forward 開始」を  │
                               │  Agent に指示            │
                               │  ──────────────────────►│
                               │                          │
                               │                          │  (3) Agent が RDS:3306 へ
                               │                          │  outbound で TCP 接続
                               │                          │  ───────────────────► RDS
                               │                          │
  (4) ローカル 13306 ⇄ mysql   │  (5) AWS が中継          │
  ◄──────────────────────►    │  ◄─────────────────────► │  ⇄ RDS
```

ポイント:

1. **踏み台への inbound は 0**。ローカルから踏み台へ直接 TCP 接続することは一度も無い。だから踏み台 SG の ingress は空でよい。
2. **踏み台の AWS への outbound があれば成立する**。このプロジェクトでは `NAT Gateway → インターネット → ssm.ap-northeast-1.amazonaws.com` 等に出ていく経路で届いている。
3. **パブリック IP も IGW へのルートも不要**。プライベートサブネットのままで良い（むしろパブリックに置くと晒すリスクが増えて損）。

### プライベートサブネットで動かすための 3 つの選択肢

踏み台の outbound が AWS SSM に届く経路さえあれば、どれでも動く。

| 方式 | 月額の目安 | 備考 |
|---|---|---|
| **NAT Gateway** | ~$32/月（本プロジェクトで採用） | Lambda も共用している既存資産 |
| **VPC Interface Endpoint** (`ssm` / `ssmmessages` / `ec2messages`) | ~$21/月（3 × ~$7.2） | インターネットを通らない。Lambda が外部 API を使わないなら NAT 廃止でさらに削減可能 |
| パブリックサブネット + パブリック IP | $0（但しセキュリティ的に非推奨） | 踏み台が直接インターネットから見える面を持ってしまう |

### SSM Agent が AWS と繋がっているかの確認

コンソールで Systems Manager → 「フリートマネージャー」を開き、踏み台が一覧に表示されていれば outbound トンネルが正常に張れている。表示されない場合は、NAT Gateway の状態、踏み台のルートテーブル、SG の egress、IAM ロール（`AmazonSSMManagedInstanceCore`）を順に確認する。

---

## 1. 前提

### ローカル PC にインストールしておくもの

| ツール | 用途 | インストール |
|---|---|---|
| AWS CLI v2 | `aws ssm start-session` 実行 | [公式ガイド](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| Session Manager plugin | `start-session` の実体 | [公式ガイド](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) |
| MySQL クライアント | `mysql` コマンド | macOS: `brew install mysql-client` / Ubuntu: `sudo apt install mysql-client` |

Session Manager plugin が入っているかは以下で確認できる。

```bash
session-manager-plugin --version
```

### AWS CLI の認証情報について

`aws ssm start-session` は裏で AWS API を叩くため、**ローカルに AWS CLI の認証情報が必須**。  ブラウザでコンソールにログインしているだけでは CLI からは使えない。

このプロジェクトでは **AWS IAM Identity Center (旧 AWS SSO)** を利用しているため、`aws sso login` で一時クレデンシャルを取得する。

#### 初回のみ: SSO プロファイルを設定

`~/.aws/config` に SSO プロファイルを作る。以下を対話式で設定してくれる。

```bash
aws configure sso
```

プロンプトで聞かれるもの（例）:

```
SSO session name:        my-sso
SSO start URL:           https://<your-org>.awsapps.com/start
SSO region:              ap-northeast-1
SSO registration scopes: sso:account:access
```

ブラウザが開き、Identity Center にサインイン → アカウントとロールを選択 → プロファイル名（例: `practice-stg`）を決めて保存する。

`~/.aws/config` に下記のようなエントリが追加される:

```ini
[profile practice-stg]
sso_session          = my-sso
sso_account_id       = 123456789012
sso_role_name        = DeveloperAccess
region               = ap-northeast-1
output               = json

[sso-session my-sso]
sso_start_url        = https://<your-org>.awsapps.com/start
sso_region           = ap-northeast-1
sso_registration_scopes = sso:account:access
```

#### 毎回の作業前: `aws sso login`

SSO の一時クレデンシャルは 8〜12 時間程度で期限切れになる。作業前に以下を実行。

```bash
aws sso login --profile practice-stg
```

ブラウザが開いて承認画面が出る → 「Confirm and continue」→ ターミナルに戻り `Successfully logged into Start URL` と出れば OK。

認証できているかは以下で確認。

```bash
aws sts get-caller-identity --profile practice-stg
# Account, UserId, Arn が表示されればログイン済み
```

以降のコマンドは下記の環境変数を設定している前提で書く。

```bash
export AWS_PROFILE=practice-stg
export AWS_REGION=ap-northeast-1
```

### AWS 側の権限

ログインした SSO ロール（上記例では `DeveloperAccess`）に以下が必要。

- `ssm:StartSession`（対象の EC2 に対して）
- `ssm:TerminateSession`（自分のセッションに対して）

通常の開発者ロール（`DeveloperAccess` / `PowerUserAccess` など）には既に含まれていることが多い。含まれていない場合は Identity Center 側で PermissionSet を調整する。

---

## 2. 必要な値を AWS コンソールから取得

ブラウザで AWS コンソールにログインして、以下 3 つをメモしておく。CLI でも取れるが、コンソールの方が早い。

### a. 踏み台のインスタンス ID

1. EC2 → 「インスタンス」
2. 名前が `<project_name>-bastion` のインスタンスを探す
3. 詳細ペインの「インスタンス ID」（`i-xxxxxxxxxxxxxxxxx`）をコピー
4. 「インスタンスの状態」が **実行中 (running)** であることを確認

### b. RDS のエンドポイント

1. RDS → 「データベース」
2. DB 識別子が `<project_name>-db` のインスタンスをクリック
3. 「接続とセキュリティ」タブ → 「エンドポイント」をコピー
   - 例: `practice-stg-db.xxxxxxxxxxxx.ap-northeast-1.rds.amazonaws.com`

### c. DB マスターパスワード

**Secrets Manager から取得する**（Parameter Store ではない）。

1. AWS Secrets Manager → 「シークレット」
2. `<project_name>/rds-credentials` を開く（例: `practice-stg/rds-credentials`）
3. 「シークレットの値を取得する」をクリック
4. JSON が表示されるので `password` の値をコピー
   ```json
   {
     "username": "admin",
     "password": "xxxxxxxxxxxxxxxxxxxxxxxxx"
   }
   ```

> **なぜ Parameter Store ではなく Secrets Manager なのか**: このプロジェクトは RDS Proxy 用の認証情報を Secrets Manager に置いており、さらに 30 日ごとの自動パスワードローテーションを有効にしている（`secrets_manager.tf` / `docs/secrets-manager-guide.md`）。ローテーション Lambda は **Secrets Manager と RDS の実パスワードだけを更新し、SSM Parameter Store は初期値のまま取り残される**。そのため Parameter Store の値を使っても `Access denied for user` になる。RDS Proxy 経由の Lambda が参照するのと同じ Secrets Manager を参照するのが唯一正しい取得先。

> **注意**: パスワードをシェル履歴に残さないこと。後述のコマンドではプロンプトに貼り付けるだけなので履歴には残らない。

---

## 3. 1 つのターミナルで接続から SQL 実行まで行う

Session Manager のポートフォワーディングは前景プロセスとして張りっぱなしにするため、「素朴にやると」ポートフォワーディング用と `mysql` 用で **ターミナルを 2 つ開く必要がある**。

しかし、`start-session` をバックグラウンドで起動し、終了時に一緒に片付ける wrapper を書けば 1 ターミナルで完結できる。**推奨はこちら**。

### ワンライナー（そのままコピペで使える）

2. で取得した値を 4 箇所の `<...>` に埋めて実行する。

```bash
INSTANCE_ID=<i-xxxxxxxxxxxxxxxxx>   RDS_ENDPOINT=<practice-stg-db.xxxxx.ap-northeast-1.rds.amazonaws.com>   DB_USER=<db_username>   bash -c '
    aws ssm start-session \
      --target "$INSTANCE_ID" \
      --document-name AWS-StartPortForwardingSessionToRemoteHost \
      --parameters "host=$RDS_ENDPOINT,portNumber=3306,localPortNumber=13306" \
      >/tmp/ssm.log 2>&1 &
    SSM_PID=$!
    trap "kill $SSM_PID 2>/dev/null" EXIT

    until grep -q "Waiting for connections" /tmp/ssm.log 2>/dev/null; do
      sleep 1
      kill -0 $SSM_PID 2>/dev/null || { echo "port-forward failed:"; cat /tmp/ssm.log; exit 1; }
    done

    mysql -h 127.0.0.1 -P 13306 -u "$DB_USER" -p
  '
```

流れ:

1. `aws ssm start-session` をバックグラウンドで起動
2. `trap "kill $SSM_PID" EXIT` で、このブロックが終わる時に必ずポートフォワーディングを止める
3. ログに `Waiting for connections` が出るまで最大数秒待つ（準備完了の合図）
4. `mysql` を前景で起動、パスワードプロンプトに 2.c のパスワードを貼る
5. `mysql` を `exit` で抜けると、`trap` が発動してポートフォワーディングも自動で終了

接続後は普通に SQL を叩ける。

```sql
SHOW DATABASES;
USE <db_name>;
SHOW TABLES;
SELECT VERSION();
```

> **`127.0.0.1` を必ず使う**。`localhost` だと OS によっては Unix ソケット接続を優先してしまい、ポートフォワーディングが使われない。

### スクリプトとして保存したい場合

頻繁に使うなら `~/bin/db-connect.sh` のように保存しておくと楽。

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${AWS_PROFILE:=practice-stg}"
export AWS_PROFILE
export AWS_REGION=ap-northeast-1

INSTANCE_ID="i-xxxxxxxxxxxxxxxxx"
RDS_ENDPOINT="practice-stg-db.xxxxx.ap-northeast-1.rds.amazonaws.com"
DB_USER="admin"

aws ssm start-session \
  --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$RDS_ENDPOINT,portNumber=3306,localPortNumber=13306" \
  >/tmp/ssm.log 2>&1 &
SSM_PID=$!
trap "kill $SSM_PID 2>/dev/null || true" EXIT

until grep -q "Waiting for connections" /tmp/ssm.log 2>/dev/null; do
  sleep 1
  kill -0 $SSM_PID 2>/dev/null || { echo "port-forward failed:"; cat /tmp/ssm.log; exit 1; }
done

exec mysql -h 127.0.0.1 -P 13306 -u "$DB_USER" -p
```

```bash
chmod +x ~/bin/db-connect.sh
~/bin/db-connect.sh   # パスワードプロンプトが出る
```

---

## 4. 2 ターミナルに分ける方法（代替）

ワンライナーを使わず素朴にやる場合はターミナルを 2 つ使う。デバッグ時はこちらの方がポートフォワーディングのログが見えて楽。

### ターミナル A: ポートフォワーディング

```bash
aws ssm start-session \
  --target <i-xxxxxxxxxxxxxxxxx> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=<practice-stg-db.xxxxx.ap-northeast-1.rds.amazonaws.com>,portNumber=3306,localPortNumber=13306"
```

```
Starting session with SessionId: xxxxx
Port 13306 opened for sessionId xxxxx.
Waiting for connections...
```

と出たらそのまま放置。

### ターミナル B: mysql 接続

```bash
mysql -h 127.0.0.1 -P 13306 -u <db_username> -p
```

作業が終わったら `mysql` を `exit` で抜け、ターミナル A を **Ctrl+C** で止める。

---

## 5. よくあるエラーと対処

### `Unable to locate credentials` / `ExpiredToken`

- SSO のトークンが切れている。
- 対処: `aws sso login --profile practice-stg` をもう一度実行。

### `TargetNotConnected`

```
An error occurred (TargetNotConnected) when calling the StartSession operation
```

- 踏み台が停止している、もしくは SSM Agent が AWS に繋がっていない。
- 対処:
  1. コンソールで踏み台が「実行中」か確認
  2. コンソールで Systems Manager → 「フリートマネージャー」で対象インスタンスが表示されているか確認
  3. NAT Gateway が動いているか、踏み台のサブネットから NAT へのルートがあるか確認
  4. 踏み台 SG の egress が全許可になっているか確認

### `AccessDeniedException` / `is not authorized to perform: ssm:StartSession`

- ログインしている SSO ロールに `ssm:StartSession` 権限が無い。
- 対処: Identity Center の PermissionSet を調整、もしくは適切なロールで `aws sso login` し直す。

### `ERROR 2003 (HY000): Can't connect to MySQL server on '127.0.0.1:13306'`

- ポートフォワーディングがまだ起動しきっていない / 落ちている。
- 対処: `/tmp/ssm.log`（ワンライナーの場合）か ターミナル A の表示を確認。`Port 13306 opened` が出ていれば接続可能状態。

### `ERROR 1045 (28000): Access denied for user`

- パスワードが間違っている、もしくはユーザ名が違う。
- 対処: **Secrets Manager の `<project_name>/rds-credentials`** から最新のパスワードを再コピー（Parameter Store の値はローテーション後に古くなっているので使わない）。ユーザ名は同じシークレット内の `username` フィールドを確認する。

### 接続するがすぐ切れる

- Session Manager のアイドルタイムアウト（デフォルト 20 分）で自動切断される。
- 対処: 長時間作業するなら `mysql` 内で `SELECT 1;` を定期的に叩く、もしくは `mysql` の `--wait` オプションを使う。

---

## 6. 補足: RDS Proxy に転送したい場合

現状は RDS に直接転送する設計だが、RDS Proxy の挙動を確認したい場合は以下で対応できる。

1. `security_groups.tf` の `rds_proxy_sg` に bastion_sg からの ingress を追加（3306/tcp）
2. `start-session` の `host` を RDS Proxy のエンドポイントに変更（コンソールの RDS → 「プロキシ」から取得）
3. Proxy は IAM 認証 + TLS 必須。`mysql` コマンドの引数が変わる。
   ```bash
   TOKEN=$(aws rds generate-db-auth-token \
     --hostname <proxy-endpoint> \
     --port 3306 \
     --username <db_username>)

   mysql -h 127.0.0.1 -P 13306 -u <db_username> \
     --password="$TOKEN" \
     --enable-cleartext-plugin \
     --ssl-mode=REQUIRED
   ```

ローカルから Proxy を使うのは手間が多いので、**特別な理由が無ければ RDS 直接接続で十分**。

---

## 関連ドキュメント

- `docs/rds-proxy-iam-auth-guide.md` — RDS Proxy の IAM 認証の詳細
- `docs/secrets-manager-guide.md` — パスワードローテーションの仕組み
