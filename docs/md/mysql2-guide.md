# mysql2 ライブラリガイド

## mysql2 とは

Node.js から **MySQL データベースに接続して SQL を実行するためのライブラリ**。
元々あった `mysql` パッケージの改良版で、パフォーマンスが向上し、Promise や Prepared Statement に対応している。

## mysql2 と mysql2/promise の違い

`mysql2` には2つの API スタイルがある。

### コールバック版（mysql2）

```typescript
import mysql from 'mysql2';
const pool = mysql.createPool({ host: 'localhost', user: 'root', database: 'mydb' });

// コールバックで結果を受け取る
pool.query('SELECT * FROM users', (err, results) => {
  if (err) throw err;
  console.log(results);
});
```

### Promise版（mysql2/promise）

```typescript
import mysql from 'mysql2/promise';
const pool = mysql.createPool({ host: 'localhost', user: 'root', database: 'mydb' });

// await で結果を受け取れる
const [results] = await pool.query('SELECT * FROM users');
console.log(results);
```

`mysql2/promise` は同じライブラリの **Promise 対応版のエントリポイント**。
`async/await` が使えるのでモダンなコードでは基本こちらを使う。
このプロジェクトでも `mysql2/promise` を使用している。

## `import mysql from 'mysql2/promise'` の意味

- `mysql2` → ライブラリ名
- `/promise` → そのライブラリ内の Promise 版エントリポイント（サブパス）

`mysql` という変数名は任意で、ライブラリのデフォルトエクスポートに付ける名前。
以下のように書いても動作は同じ：

```typescript
import db from 'mysql2/promise';       // OK
import mysqlLib from 'mysql2/promise';  // OK
```

## Pool（プール）とは

データベース接続を使い回す仕組み。

```
リクエスト1 → プールから接続を借りる → SQL実行 → 接続を返す
リクエスト2 → プールから接続を借りる → SQL実行 → 接続を返す
```

毎回新しい接続を作ると遅いので、あらかじめ複数の接続を保持しておき、必要なときに貸し出す。

```typescript
const pool = mysql.createPool({
  host: 'localhost',
  port: 3306,
  database: 'mydb',
  user: 'user',
  password: 'password',
  waitForConnections: true, // 接続が空くまで待つか
  connectionLimit: 10,      // 最大接続数
});
```

## このプロジェクトでの使われ方（database.ts）

```typescript
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

// mysql2 で接続プールを作成
const pool = mysql.createPool({ host: ..., port: ..., ... });

// drizzle ORM に渡して、SQL を TypeScript で安全に書けるようにする
const db = drizzle(pool, { schema, mode: 'default' });
```

直接 SQL を書く代わりに、drizzle ORM 経由でデータベースを操作している。
mysql2 は「データベースへの接続」を担当し、drizzle は「SQL の組み立てと型安全性」を担当する。

## 型エラーについて（ReturnType の罠）

### 問題

```typescript
let db: ReturnType<typeof drizzle>;
```

`ReturnType<typeof drizzle>` は引数なしで `drizzle` の戻り値型を推論するため、
`$client` がデフォルトの `CallbackPool`（コールバック版の Pool）になる。
しかし実際には `mysql2/promise` の `Pool`（Promise版）を渡しているので型が不一致になる。

### 解決

```typescript
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

let db: MySql2Database<typeof schema> & { $client: mysql.Pool };
```

Promise 版の `Pool` と一致するように明示的に型を指定する。

## Lambda + RDS Proxy での Pool について

### Lambda の課題

Lambda は同時リクエストごとに独立したプロセスが起動する。
各プロセスが独自に Pool を作るため、接続数が爆発する。

```
通常のサーバー（1台）:
  サーバー → Pool(10接続) → RDS
  ※ 接続を使い回せるので効率的

Lambda（同時100リクエスト）:
  Lambda①  → Pool(10接続) → RDS
  Lambda②  → Pool(10接続) → RDS
  Lambda③  → Pool(10接続) → RDS
  ...
  → 最大 100 × 10 = 1000接続！RDS が耐えられない
```

### RDS Proxy で解決

RDS Proxy が Lambda からの接続をまとめて、RDS への接続数を抑える。

```
Lambda①  → Pool(1接続) →┐
Lambda②  → Pool(1接続) → RDS Proxy → RDS
Lambda③  → Pool(1接続) →┘
→ RDS Proxy が接続をまとめてくれる
```

- `connectionLimit: 1` — Lambda 1インスタンスに接続1本で十分。Proxy が束ねてくれる
- Pool 自体は使う — `mysql2` の API として Pool を使うだけで問題ない。接続1本の Pool は実質単一接続と同じ
- ライブラリを変える必要はない

このプロジェクトの `database.ts` で IAM 認証時に `connectionLimit: 1` にしているのはまさにこの理由。

## PostgreSQL（pg）と MariaDB/MySQL（mysql2）の書き方の違い

使う DB に応じて drizzle の import 先と接続ライブラリが変わる。

```typescript
// PostgreSQL の場合
import { drizzle } from 'drizzle-orm/node-postgres'  // ← postgres用
import { Pool } from 'pg'                             // ← pg ライブラリ

const pool = new Pool({ connectionString: '...' })
export const db = drizzle(pool, { schema })

// MariaDB/MySQL の場合（今回のプロジェクト）
import { drizzle } from 'drizzle-orm/mysql2'          // ← mysql用
import mysql from 'mysql2/promise'                     // ← mysql2 ライブラリ

const pool = mysql.createPool({ host: '...', port: 3306, ... })
export const db = drizzle(pool, { schema, mode: 'default' })
```

| | PostgreSQL | MariaDB/MySQL |
|---|---|---|
| 接続ライブラリ | `pg` | `mysql2/promise` |
| drizzle の import | `drizzle-orm/node-postgres` | `drizzle-orm/mysql2` |
| Pool の作り方 | `new Pool({...})` | `mysql.createPool({...})` |
| 接続文字列 | `connectionString` 1本で指定 | `host`, `port`, `user` 等を個別に指定 |
| `mode` | 不要 | `mode: 'default'` が必要 |

drizzle を使う側のコード（クエリ部分）はほぼ同じ。違いは接続部分だけなので `database.ts` に差が集約されている。

## Lambda + RDS Proxy での TLS（SSL）接続

### 2 区間の TLS

Lambda から RDS Proxy 経由で RDS に接続する場合、TLS 通信は 2 区間に分かれる。

```
Lambda ──TLS①──→ RDS Proxy ──TLS②──→ RDS
```

| 区間 | 制御方法 | 証明書 |
|---|---|---|
| Lambda → RDS Proxy | Terraform の `require_tls = true` で強制。Lambda 側は `ssl: { rejectUnauthorized: true }` で検証 | **Amazon Trust Services** のパブリック CA が発行 |
| RDS Proxy → RDS | RDS Proxy が内部的に自動で TLS 接続する。ユーザー側の設定は不要 | RDS Proxy が内部的に検証（AWS が管理） |

Lambda が気にするのは RDS Proxy までの TLS だけ。Proxy から先は AWS が面倒を見てくれる。

### Dockerfile に CA 証明書のインストールは不要

RDS Proxy の証明書は **Amazon Trust Services** のパブリック CA が発行している。
この CA は Node.js にデフォルトで含まれている **Mozilla CA バンドル** に入っているため、
Lambda の Docker イメージに追加の証明書をインストールする必要はない。

```typescript
// database.ts（IAM 認証時）
pool = mysql.createPool({
  host: env.DATABASE_HOST,
  ssl: { rejectUnauthorized: true }, // ← 追加の CA 証明書なしで動作する
  // ...
});
```

### RDS に直接 TLS 接続する場合との違い

RDS Proxy を経由せず RDS に直接 TLS 接続する場合は事情が異なる。

| 接続先 | 証明書の発行元 | Node.js デフォルトの CA バンドルに含まれるか |
|---|---|---|
| RDS Proxy | Amazon Trust Services（パブリック CA） | 含まれる → 追加インストール不要 |
| RDS（直接） | Amazon RDS 専用 CA（`rds-ca-rsa2048-g1` 等） | **含まれない** → CA 証明書のダウンロードと設定が必要 |

RDS に直接 TLS 接続する場合は、Amazon RDS の CA 証明書バンドルをダウンロードして
Dockerfile に組み込み、`ssl.ca` オプションで指定する必要がある。

```typescript
// RDS 直接接続の場合（参考）
import fs from 'node:fs';

pool = mysql.createPool({
  host: 'rds-instance.xxxx.ap-northeast-1.rds.amazonaws.com',
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/amazon-rds-ca-bundle.pem'), // ← 必要
  },
});
```

このプロジェクトでは RDS Proxy 経由で接続しているため、上記の対応は不要。

### connectionString とは

接続情報を1つの URL 文字列にまとめたもの。環境変数 `DATABASE_URL` として設定されることが多い。

```
postgresql://user:password@host:5432/database
↑プロトコル  ↑ユーザー ↑パスワード ↑ホスト ↑ポート ↑DB名
```

MySQL でも同様の形式はあるが、`mysql2` では `host`, `port`, `user`, `password` 等を個別に指定するのが一般的。
