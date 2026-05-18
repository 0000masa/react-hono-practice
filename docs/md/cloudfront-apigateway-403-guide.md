# CloudFront + API Gateway 403 Forbidden トラブルシューティング

## 概要

CloudFront 経由で API Gateway REST API にリクエストを送ると `403 Forbidden` が返る問題と、その原因・修正方法をまとめる。

## 症状

```
GET https://www.favoritemyanime.com/api/auth/google
→ 403 {"message":"Forbidden"}
```

- CloudFront 経由で API Gateway にアクセスすると 403 になる
- Lambda には到達していない（API Gateway レベルで拒否）
- `{"message":"Forbidden"}` は API Gateway REST API 固有のレスポンス形式

## 原因: `Managed-AllViewer` が Host ヘッダーを転送している

### リクエストフロー（修正前）

```
ブラウザ
  │  GET /api/auth/google
  │  Host: www.favoritemyanime.com
  ▼
CloudFront （/api/* にマッチ → backend-api オリジンにルーティング）
  │  Managed-AllViewer ポリシーにより
  │  Host: www.favoritemyanime.com をそのまま転送
  │  x-api-key: xxxxxxxx（カスタムヘッダーで付与）
  ▼
API Gateway REST API
  │  Host ヘッダーで API を識別しようとする
  │  → www.favoritemyanime.com はカスタムドメイン未設定
  │  → API を特定できない
  ▼
403 Forbidden {"message":"Forbidden"}
※ x-api-key の検証以前に、Host ヘッダーで拒否される
```

### 根本原因の詳細

API Gateway REST API は、受信リクエストの **`Host` ヘッダー** を使って対象の API を識別する。

| Host ヘッダーの値 | API Gateway の動作 |
|---|---|
| `{api-id}.execute-api.{region}.amazonaws.com` | デフォルトエンドポイントとして認識 → 正常処理 |
| カスタムドメイン（API Gateway に設定済み） | カスタムドメインマッピングで認識 → 正常処理 |
| **上記以外（例: `www.favoritemyanime.com`）** | **API を特定できない → 403 Forbidden** |

CloudFront の Origin Request Policy には以下の2つがある:

| ポリシー名 | Host ヘッダー | その他のヘッダー |
|---|---|---|
| `Managed-AllViewer` | **ビューワーの Host を転送**（例: `www.favoritemyanime.com`） | 全て転送 |
| `Managed-AllViewerExceptHostHeader` | **オリジンの Host に自動変換**（例: `{api-id}.execute-api...`） | 全て転送 |

`Managed-AllViewer` を使うと、ブラウザの `Host: www.favoritemyanime.com` がそのまま API Gateway に渡される。API Gateway にこのドメインのカスタムドメイン設定がないため、API を識別できず 403 になる。

## 修正方法

### 変更するファイル

**`terraform/modules/app-infrastructure/data.tf`**

```diff
- # API用なので「Cookieやヘッダーを全て通す」ポリシーを取得
- data "aws_cloudfront_origin_request_policy" "all_viewer" {
-   name = "Managed-AllViewer"
- }
+ # API用なので「Cookieやヘッダーを全て通す（Hostヘッダー除く）」ポリシーを取得
+ # Managed-AllViewer だと Host ヘッダー（www.favoritemyanime.com）がそのまま
+ # API Gateway に転送され、カスタムドメイン未設定のため 403 Forbidden になる。
+ # ExceptHostHeader を使うことで CloudFront がオリジンの Host に自動変換する。
+ data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
+   name = "Managed-AllViewerExceptHostHeader"
+ }
```

**`terraform/modules/app-infrastructure/cloudfront.tf`**（`ordered_cache_behavior` 内）

```diff
- origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
+ origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
```

### リクエストフロー（修正後）

```
ブラウザ
  │  GET /api/auth/google
  │  Host: www.favoritemyanime.com
  ▼
CloudFront （/api/* にマッチ → backend-api オリジンにルーティング）
  │  Managed-AllViewerExceptHostHeader ポリシーにより
  │  Host: {api-id}.execute-api.ap-northeast-1.amazonaws.com に変換
  │  x-api-key: xxxxxxxx（カスタムヘッダーで付与）
  │  Cookie, その他ヘッダーはそのまま転送
  ▼
API Gateway REST API
  │  Host ヘッダーで API を正しく識別
  │  x-api-key を検証 → OK
  ▼
Lambda (Hono API)
  │  /api/auth/google を処理
  ▼
200 OK { "url": "https://accounts.google.com/o/oauth2/..." }
```

### 適用手順

```bash
cd terraform/stg
terraform plan    # 変更内容を確認（CloudFront の origin_request_policy_id が変わる）
terraform apply   # 適用
```

> CloudFront ディストリビューションの更新には数分かかる場合がある。

## 補足: API Gateway の二重防御

このプロジェクトでは、API Gateway への直接アクセスを防ぐために **API キー認証** を採用している。

```
CloudFront 経由:  CloudFront → x-api-key 付与 → API Gateway → 認証OK → Lambda
直接アクセス:     攻撃者 → API Gateway → API キー無し → 403 Forbidden
```

- CloudFront オリジンの `custom_header` で `x-api-key` を付与（`cloudfront.tf`）
- API Gateway の全メソッドに `api_key_required = true` を設定（`api_gateway.tf`）
- API キーの値は `random_password` リソースで生成し、CloudFront と API Gateway で共有

今回の 403 は API キー認証ではなく、その **手前の Host ヘッダー検証** で弾かれていた。

## 判別方法: 403 の発生元を特定する

同じ 403 でも、発生元によってレスポンス形式が異なる:

| 発生元 | レスポンス形式 | 典型的な原因 |
|---|---|---|
| **API Gateway** | `{"message":"Forbidden"}` (JSON) | Host ヘッダー不一致、API キー不正/未設定 |
| **CloudFront WAF** | HTML (`<html>403 Forbidden</html>`) | WAF ルール（XSS、SQLi 等）に該当 |
| **CloudFront** | HTML またはカスタムエラーページ | オリジン接続失敗、地理的制限 |

`{"message":"Forbidden"}` という JSON レスポンスが返ってきた場合は API Gateway が原因。CloudWatch Logs（`/apigateway/{project-name}`）のアクセスログを確認すると、リクエストの詳細がわかる。

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `terraform/modules/app-infrastructure/data.tf` | CloudFront ポリシーの data source 定義 |
| `terraform/modules/app-infrastructure/cloudfront.tf` | CloudFront ディストリビューション設定 |
| `terraform/modules/app-infrastructure/api_gateway.tf` | API Gateway REST API・API キー設定 |
| `terraform/modules/app-infrastructure/waf.tf` | CloudFront 用 WAF Web ACL |
