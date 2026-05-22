// APIのベースURL（環境変数から取得、デフォルトはnginx経由の/api）
// フロントエンド（Vite）では process.env ではなく import.meta.env で環境変数を取得する
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// ジェネリクス: 型を引数のように渡せる仕組み
// <T = unknown> の T は呼び出し側が具体的な型を決める。= unknown はデフォルト型
// 例: ApiResponse<User> → data は User 型になる
//     ApiResponse<string[]> → data は string[] 型になる
interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
}

// クラス: データ（プロパティ）と振る舞い（メソッド）をまとめた設計図。new でインスタンスを作る
// extends Error: 組み込みの Error クラスを継承し、message や stack の機能を引き継ぎつつ
//               status という追加情報を持てるようにしている
class ApiError extends Error {
  // プロパティの宣言。この時点では undefined
  // ? は省略可能（undefined を許容する）という意味
  status?: number;
  response?: { status?: number };

  // constructor: new したときに自動で呼ばれる初期化用の関数
  // 例: new ApiError("Not Found", 404) → message="Not Found", status=404 でここが実行される
  constructor(message: string, status?: number) {
    // super(): 親クラス（Error）の constructor を呼ぶ。extends したクラスでは this を使う前に必ず呼ぶ必要がある
    // これにより err.message が "Not Found" になる
    super(message);
    // this: そのインスタンス自身を指す。「自分の status に 404 を入れる」という意味
    this.status = status;
    // { status } は { status: status } の省略記法（shorthand property）
    this.response = { status };
  }
}

// <T = unknown> のジェネリクスにより、呼び出し側が request<User>(...) とすると
// 戻り値が Promise<ApiResponse<User>> になり、data が User 型として扱える
async function request<T = unknown>(
  method: string,
  url: string,
  options?: { params?: Record<string, string | number>; data?: unknown }
): Promise<ApiResponse<T>> {
  let fullUrl = `${API_BASE_URL}${url}`;

  // Record<string, string | number>: 「キーが string、値が string | number のオブジェクト」を表す型
  // 例: { page: 1, sort: "name", limit: 20 }

  // options?.params の ?. はオプショナルチェーニング
  // options が undefined の場合にエラーにならず、そのまま undefined を返す
  if (options?.params) {
    // URLSearchParams: クエリ文字列を組み立てるブラウザ組み込みクラス
    const searchParams = new URLSearchParams();

    // Object.entries(): オブジェクトを [キー, 値] のペアの配列に変換するメソッド
    // 例: Object.entries({ page: 1, sort: "name" }) → [["page", 1], ["sort", "name"]]
    // 似たメソッド:
    //   Object.keys(obj)    → ["page", "sort"]       キーだけ
    //   Object.values(obj)  → [1, "name"]            値だけ
    //   Object.entries(obj) → [["page",1], ["sort","name"]]  両方
    // [key, value] は分割代入（destructuring）で各ペアのキーと値を取り出している
    // 変数名は任意でOK（[k, v] や [a, b] でも動く）。名前ではなく順番で対応する（1番目=キー、2番目=値）
    // ただし key/value が最も意図が伝わりやすいので慣習的によく使われる
    for (const [key, value] of Object.entries(options.params)) {
      // URLSearchParams は string しか受け付けないので String() で変換
      searchParams.set(key, String(value));
    }
    // searchParams.toString() → "page=1&sort=name"
    // 結果: "/api/users?page=1&sort=name" のようなURLになる
    fullUrl += `?${searchParams.toString()}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
  };

  if (options?.data) {
    fetchOptions.body = JSON.stringify(options.data);
  }

  const response = await fetch(fullUrl, fetchOptions);

  if (!response.ok) {
    // 401エラーの場合、ログイン画面へリダイレクト
    if (response.status === 401) {
      const currentPath = window.location.pathname;
      if (currentPath !== '/login' && currentPath !== '/auth/callback') {
        window.location.href = '/login';
      }
    }
    // throw で投げたエラーはコールスタックを遡り、呼び出し元の最も近い catch(err) に渡される
    // 例: apiClient.get() → request() → throw → catch(err) で err として受け取れる
    // err は ApiError のインスタンスなので err.status や err.message にもアクセスできる
    throw new ApiError(`Request failed with status ${response.status}`, response.status);
  }

  const data = await response.json() as T;
  return { data, status: response.status, ok: response.ok };
}

// HTTPメソッドごとの便利関数をまとめたオブジェクト
// 利用例:
//   const res = await apiClient.get<User[]>("/users");  // res.data は User[] 型
//   await apiClient.post("/users", { name: "Taro" });
//
// メソッドの短縮記法（shorthand method syntax）を使用している
// 値が関数の場合に限り、`:` と `function` キーワードを省略できる（ES2015 で導入）
// 通常記法:   get: function<T>(url, config?) { ... },
// 短縮記法:   get<T>(url, config?) { ... },
// ※ アロー関数で書く場合は短縮記法は使えず `:` が必要（例: get: <T>(url) => ...）
const apiClient = {
  get<T = unknown>(url: string, config?: { params?: Record<string, string | number> }) {
    return request<T>('GET', url, config);
  },
  post<T = unknown>(url: string, data?: unknown) {
    return request<T>('POST', url, { data });
  },
  put<T = unknown>(url: string, data?: unknown) {
    return request<T>('PUT', url, { data });
  },
  delete<T = unknown>(url: string) {
    return request<T>('DELETE', url);
  },
};

export default apiClient;
