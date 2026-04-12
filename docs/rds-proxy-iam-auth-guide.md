# RDS Proxy IAM 認証トラブルシューティング

## 概要

Lambda から RDS Proxy に IAM 認証で接続する際に発生した `Access denied (using password: NO)` エラーの原因と修正内容をまとめる。

## 発生したエラー

```
Access denied for user 'admin'@'192.168.x.x' (using password: NO)
```

Lambda でマイグレーション（`drizzle-orm` の `migrate()`）を実行すると、上記エラーで失敗していた。

## 調査の過程

### 1. エラーメッセージの取得

drizzle-orm は元の MySQL エラーを `cause` プロパティに格納するが、デフォルトでは表示されない。
`try-catch` で `error.cause` をログ出力することで、実際の MySQL エラーを確認できた。

### 2. `using password: NO` の意味

通常の MySQL では「パスワードが送信されていない」ことを意味する。
しかし RDS Proxy の IAM 認証では、「**IAM 認証に失敗した**」場合にもこのメッセージが返される。

### 3. mysql2 の認証フローの確認

`mysql2` の接続オプションに `debug: true` を設定し、MySQL プロトコルレベルの認証ハンドシェイクを確認した。

実際の認証フロー：

```
1. RDS Proxy → Lambda: サーバーハンドシェイク（auth method: mysql_native_password）
2. Lambda → RDS Proxy: TLS アップグレード要求
3.         （TLS ハンドシェイク）
4. Lambda → RDS Proxy: mysql_native_password のハッシュを送信
5. RDS Proxy → Lambda: auth switch 要求（mysql_clear_password に切り替え）
6. Lambda → RDS Proxy: IAM トークンを平文で送信（1518バイト）
7. RDS Proxy → Lambda: Access denied (using password: NO)
```

ステップ 6 で IAM トークンは正しく送信されていた。
つまり **mysql2 の問題ではなく、IAM 認証の検証段階で失敗** していた。

### 4. 除外した仮説

| 仮説 | 結果 |
|---|---|
| TLS 証明書の問題 | RDS Proxy は Amazon Trust Services の公開 CA を使用。Node.js のデフォルト CA バンドルに含まれるため問題なし |
| mysql2 の `mysql_clear_password` プラグイン未対応 | mysql2 v3.20.0 は対応済み。RDS Proxy からの auth switch 要求に正しく応答していた |
| IAM トークンの生成失敗 | `@aws-sdk/rds-signer` の `getAuthToken()` は正常にトークンを生成していた（1518文字） |
| esbuild バンドルの問題 | バンドル後のコードを確認し、`db` 変数のライブバインディングは正しく動作していた |

## 根本原因

**IAM ポリシーの Resource ARN が間違っていた。**

`rds-db:connect` アクションの Resource ARN には、RDS Proxy の**リソース ID**（`prx-xxx` 形式）が必要だが、Proxy の**名前**を使用していた。

### 修正前（間違い）

```hcl
# aws_db_proxy.main.id は Proxy の「名前」（例: "kum-stg-rds-proxy"）を返す
Resource = "arn:aws:rds-db:ap-northeast-1:${account_id}:dbuser:${aws_db_proxy.main.id}/${var.db_username}"
# 結果: arn:aws:rds-db:ap-northeast-1:123456789:dbuser:kum-stg-rds-proxy/admin
```

### 修正後（正しい）

```hcl
# Proxy の ARN（arn:aws:rds:{region}:{account}:db-proxy:prx-xxx）からリソース ID を抽出
Resource = "arn:aws:rds-db:ap-northeast-1:${account_id}:dbuser:${element(split(":", aws_db_proxy.main.arn), 6)}/${var.db_username}"
# 結果: arn:aws:rds-db:ap-northeast-1:123456789:dbuser:prx-cd066iea4uze/admin
```

### ARN の構造の違い

| 種類 | ARN 形式 |
|---|---|
| RDS Proxy 自体の ARN | `arn:aws:rds:{region}:{account}:db-proxy:prx-xxx` |
| `rds-db:connect` の Resource ARN | `arn:aws:rds-db:{region}:{account}:dbuser:prx-xxx/{username}` |

`rds-db:connect` の Resource ARN は `rds-db` サービス名前空間を使い、`dbuser:` の後にリソース ID（`prx-xxx`）が来る。
Terraform の `aws_db_proxy` リソースでは：
- `id` → Proxy の**名前**（例: `kum-stg-rds-proxy`）
- `arn` → Proxy の**完全な ARN**（例: `arn:aws:rds:ap-northeast-1:123456789:db-proxy:prx-xxx`）

`arn` の 7 番目の `:` 区切り要素がリソース ID になる。

## IAM 認証の全体像

```
Lambda
  │
  │ 1. IAM トークン生成（@aws-sdk/rds-signer）
  │    - Lambda の実行ロールの認証情報で署名
  │    - hostname, port, username を含むプリサインド URL
  │
  │ 2. MySQL 接続（mysql2）
  │    - TLS で RDS Proxy に接続
  │    - IAM トークンをパスワードとして送信（mysql_clear_password）
  │
  ▼
RDS Proxy
  │
  │ 3. IAM トークン検証
  │    - トークンの署名を検証
  │    - Lambda の IAM ロールに rds-db:connect 権限があるか確認 ← ここで失敗していた
  │    - Resource ARN が一致するか確認
  │
  │ 4. DB 接続（Secrets Manager 認証）
  │    - Secrets Manager から DB パスワードを取得
  │    - RDS に接続
  │
  ▼
RDS (MySQL 8.4)
```

## 教訓

1. RDS Proxy の `using password: NO` は IAM 認証失敗の汎用エラーであり、文字通り「パスワードが送信されていない」とは限らない
2. Terraform の `aws_db_proxy.main.id` は名前を返す。リソース ID が必要な場合は `arn` から抽出する
3. 問題の切り分けには `mysql2` の `debug: true` オプションが有効。MySQL プロトコルレベルのパケット交換を確認できる
