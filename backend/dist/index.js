"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc3) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc3 = __getOwnPropDesc(from, key)) || desc3.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_node_server = require("@hono/node-server");

// src/app.ts
var import_hono7 = require("hono");
var import_cors = require("hono/cors");
var import_logger = require("hono/logger");

// src/config/env.ts
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
function getEnv(key, defaultValue) {
  const value = process.env[key] ?? defaultValue;
  if (value === void 0) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}
var env = {
  NODE_ENV: getEnv("NODE_ENV", "development"),
  PORT: parseInt(getEnv("PORT", "3000"), 10),
  DATABASE_HOST: getEnv("DATABASE_HOST", "mysql"),
  DATABASE_PORT: parseInt(getEnv("DATABASE_PORT", "3306"), 10),
  DATABASE_NAME: getEnv("DATABASE_NAME", "database"),
  DATABASE_USER: getEnv("DATABASE_USER", "user"),
  DATABASE_PASSWORD: getEnv("DATABASE_PASSWORD", "password"),
  GOOGLE_CLIENT_ID: getEnv("GOOGLE_CLIENT_ID", ""),
  GOOGLE_CLIENT_SECRET: getEnv("GOOGLE_CLIENT_SECRET", ""),
  GOOGLE_CALLBACK_URL: getEnv("GOOGLE_CALLBACK_URL", "http://localhost:3000/api/auth/google/callback"),
  FRONTEND_URL: getEnv("FRONTEND_URL", "http://localhost:5173"),
  SESSION_SECRET: getEnv("SESSION_SECRET", "your-secret-key"),
  S3_ENDPOINT: getEnv("S3_ENDPOINT", "http://minio:9000"),
  S3_BUCKET: getEnv("S3_BUCKET", "qrcodes"),
  S3_REGION: getEnv("S3_REGION", "us-east-1"),
  S3_ACCESS_KEY: getEnv("S3_ACCESS_KEY", "minio_root"),
  S3_SECRET_KEY: getEnv("S3_SECRET_KEY", "minio_password"),
  S3_FORCE_PATH_STYLE: getEnv("S3_FORCE_PATH_STYLE", "true") === "true",
  STORAGE_URL_BASE: getEnv("STORAGE_URL_BASE", "http://localhost:9000/qrcodes"),
  SMTP_HOST: getEnv("SMTP_HOST", "mailpit"),
  SMTP_PORT: parseInt(getEnv("SMTP_PORT", "1025"), 10),
  SMTP_SECURE: getEnv("SMTP_SECURE", "false") === "true",
  MAIL_FROM: getEnv("MAIL_FROM", "noreply@example.com"),
  get isProduction() {
    return this.NODE_ENV === "production";
  }
};

// src/middleware/session.ts
var import_factory = require("hono/factory");
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_drizzle_orm2 = require("drizzle-orm");

// src/config/database.ts
var import_mysql2 = require("drizzle-orm/mysql2");
var import_promise = __toESM(require("mysql2/promise"), 1);

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  qrCodes: () => qrCodes,
  qrCodesRelations: () => qrCodesRelations,
  sessions: () => sessions,
  users: () => users,
  usersRelations: () => usersRelations
});
var import_mysql_core = require("drizzle-orm/mysql-core");
var import_drizzle_orm = require("drizzle-orm");
var users = (0, import_mysql_core.mysqlTable)("users", {
  id: (0, import_mysql_core.bigint)("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  name: (0, import_mysql_core.varchar)("name", { length: 255 }).notNull(),
  email: (0, import_mysql_core.varchar)("email", { length: 255 }).notNull().unique(),
  password: (0, import_mysql_core.varchar)("password", { length: 255 }),
  googleId: (0, import_mysql_core.varchar)("google_id", { length: 255 }).unique(),
  avatarUrl: (0, import_mysql_core.varchar)("avatar_url", { length: 255 }),
  emailVerifiedAt: (0, import_mysql_core.timestamp)("email_verified_at"),
  rememberToken: (0, import_mysql_core.varchar)("remember_token", { length: 100 }),
  createdAt: (0, import_mysql_core.timestamp)("created_at").defaultNow().notNull(),
  updatedAt: (0, import_mysql_core.timestamp)("updated_at").defaultNow().notNull().$onUpdate(() => /* @__PURE__ */ new Date())
});
var usersRelations = (0, import_drizzle_orm.relations)(users, ({ many }) => ({
  qrCodes: many(qrCodes)
}));
var qrCodes = (0, import_mysql_core.mysqlTable)("qr_codes", {
  id: (0, import_mysql_core.bigint)("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
  userId: (0, import_mysql_core.bigint)("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: (0, import_mysql_core.varchar)("file_name", { length: 255 }).notNull().default(""),
  data: (0, import_mysql_core.text)("data"),
  status: (0, import_mysql_core.varchar)("status", { length: 20 }).notNull().default("completed"),
  createdAt: (0, import_mysql_core.timestamp)("created_at").defaultNow().notNull(),
  updatedAt: (0, import_mysql_core.timestamp)("updated_at").defaultNow().notNull().$onUpdate(() => /* @__PURE__ */ new Date())
});
var qrCodesRelations = (0, import_drizzle_orm.relations)(qrCodes, ({ one }) => ({
  user: one(users, {
    fields: [qrCodes.userId],
    references: [users.id]
  })
}));
var sessions = (0, import_mysql_core.mysqlTable)("sessions", {
  id: (0, import_mysql_core.varchar)("id", { length: 255 }).primaryKey(),
  userId: (0, import_mysql_core.bigint)("user_id", { mode: "number", unsigned: true }),
  ipAddress: (0, import_mysql_core.varchar)("ip_address", { length: 45 }),
  userAgent: (0, import_mysql_core.text)("user_agent"),
  payload: (0, import_mysql_core.text)("payload"),
  lastActivity: (0, import_mysql_core.int)("last_activity").notNull()
});

// src/config/database.ts
var pool = import_promise.default.createPool({
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  database: env.DATABASE_NAME,
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10
});
var db = (0, import_mysql2.drizzle)(pool, { schema: schema_exports, mode: "default" });

// src/middleware/session.ts
var import_cookie = require("hono/cookie");
var COOKIE_NAME = "hono_session";
var SESSION_MAX_AGE = 60 * 60 * 24 * 7;
var sessionMiddleware = (0, import_factory.createMiddleware)(async (c, next) => {
  let sessionId = (0, import_cookie.getCookie)(c, COOKIE_NAME) ?? "";
  let sessionData = {};
  let isNew = false;
  if (sessionId) {
    const [row] = await db.select().from(sessions).where((0, import_drizzle_orm2.eq)(sessions.id, sessionId)).limit(1);
    if (row?.payload) {
      try {
        sessionData = JSON.parse(row.payload);
      } catch {
        sessionData = {};
      }
    } else {
      sessionId = "";
    }
  }
  if (!sessionId) {
    sessionId = import_node_crypto.default.randomUUID();
    isNew = true;
  }
  c.set("session", sessionData);
  c.set("sessionId", sessionId);
  c.set("sessionChanged", false);
  await next();
  const changed = c.get("sessionChanged") || isNew;
  if (changed) {
    const now = Math.floor(Date.now() / 1e3);
    const payload = JSON.stringify(c.get("session"));
    const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = c.req.header("user-agent") ?? null;
    if (isNew) {
      await db.insert(sessions).values({
        id: sessionId,
        userId: c.get("session").userId ? Number(c.get("session").userId) : null,
        ipAddress,
        userAgent,
        payload,
        lastActivity: now
      });
    } else {
      await db.update(sessions).set({
        userId: c.get("session").userId ? Number(c.get("session").userId) : null,
        payload,
        lastActivity: now
      }).where((0, import_drizzle_orm2.eq)(sessions.id, sessionId));
    }
    (0, import_cookie.setCookie)(c, COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "Lax",
      secure: env.isProduction,
      maxAge: SESSION_MAX_AGE,
      path: "/"
    });
  }
});
function setSession(c, data) {
  const session = c.get("session") ?? {};
  Object.assign(session, data);
  c.set("session", session);
  c.set("sessionChanged", true);
}
async function destroySession(c) {
  const sessionId = c.get("sessionId");
  if (sessionId) {
    await db.delete(sessions).where((0, import_drizzle_orm2.eq)(sessions.id, sessionId));
  }
  c.set("session", {});
  c.set("sessionChanged", false);
}

// src/routes/index.ts
var import_hono6 = require("hono");

// src/routes/auth.ts
var import_hono = require("hono");

// src/controllers/auth.controller.ts
var import_arctic2 = require("arctic");
var import_drizzle_orm3 = require("drizzle-orm");

// src/config/auth.ts
var import_arctic = require("arctic");
var google = new import_arctic.Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL
);

// src/controllers/auth.controller.ts
var import_cookie2 = require("hono/cookie");
async function redirectToGoogle(c) {
  const state = (0, import_arctic2.generateState)();
  const codeVerifier = (0, import_arctic2.generateCodeVerifier)();
  const scopes = ["openid", "email", "profile"];
  const url = google.createAuthorizationURL(state, codeVerifier, scopes);
  (0, import_cookie2.setCookie)(c, "google_oauth_state", state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProduction,
    maxAge: 60 * 10,
    path: "/"
  });
  (0, import_cookie2.setCookie)(c, "google_code_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "Lax",
    secure: env.isProduction,
    maxAge: 60 * 10,
    path: "/"
  });
  return c.json({ url: url.toString() });
}
async function handleGoogleCallback(c) {
  const { code, state } = c.req.query();
  const storedState = (0, import_cookie2.getCookie)(c, "google_oauth_state");
  const codeVerifier = (0, import_cookie2.getCookie)(c, "google_code_verifier");
  if (!code || !state || state !== storedState || !codeVerifier) {
    return c.redirect(`${env.FRONTEND_URL}/auth/error`);
  }
  try {
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const accessToken = tokens.accessToken();
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const googleUser = await response.json();
    let [existingUser] = await db.select().from(users).where(
      (0, import_drizzle_orm3.or)(
        (0, import_drizzle_orm3.eq)(users.googleId, googleUser.id),
        (0, import_drizzle_orm3.eq)(users.email, googleUser.email)
      )
    ).limit(1);
    if (existingUser) {
      await db.update(users).set({
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
        emailVerifiedAt: existingUser.emailVerifiedAt ?? /* @__PURE__ */ new Date()
      }).where((0, import_drizzle_orm3.eq)(users.id, existingUser.id));
      existingUser = {
        ...existingUser,
        googleId: googleUser.id,
        avatarUrl: googleUser.picture
      };
    } else {
      const [result] = await db.insert(users).values({
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
        password: null,
        emailVerifiedAt: /* @__PURE__ */ new Date()
      }).$returningId();
      existingUser = {
        id: result.id,
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
        password: null,
        emailVerifiedAt: /* @__PURE__ */ new Date(),
        rememberToken: null,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      };
    }
    setSession(c, { userId: existingUser.id });
    (0, import_cookie2.deleteCookie)(c, "google_oauth_state");
    (0, import_cookie2.deleteCookie)(c, "google_code_verifier");
    return c.redirect(`${env.FRONTEND_URL}/auth/callback`);
  } catch (error) {
    console.error("Google OAuth error:", error);
    return c.redirect(`${env.FRONTEND_URL}/auth/error`);
  }
}
async function getUser(c) {
  const user = c.get("user");
  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatarUrl
    }
  });
}
async function logout(c) {
  await destroySession(c);
  (0, import_cookie2.deleteCookie)(c, "hono_session", { path: "/" });
  return c.json({ message: "\u30ED\u30B0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F" });
}

// src/middleware/auth.ts
var import_factory2 = require("hono/factory");
var import_drizzle_orm4 = require("drizzle-orm");
var authMiddleware = (0, import_factory2.createMiddleware)(async (c, next) => {
  const session = c.get("session");
  if (!session?.userId) {
    return c.json({ error: "\u8A8D\u8A3C\u304C\u5FC5\u8981\u3067\u3059" }, 401);
  }
  const [user] = await db.select().from(users).where((0, import_drizzle_orm4.eq)(users.id, session.userId)).limit(1);
  if (!user) {
    return c.json({ error: "\u8A8D\u8A3C\u304C\u5FC5\u8981\u3067\u3059" }, 401);
  }
  c.set("user", user);
  await next();
});

// src/routes/auth.ts
var auth = new import_hono.Hono();
auth.get("/google", redirectToGoogle);
auth.get("/google/callback", handleGoogleCallback);
auth.get("/user", authMiddleware, getUser);
auth.post("/logout", authMiddleware, logout);
var auth_default = auth;

// src/routes/users.ts
var import_hono2 = require("hono");

// src/controllers/users.controller.ts
var import_drizzle_orm5 = require("drizzle-orm");
var PER_PAGE = 50;
async function index(c) {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const offset = (page - 1) * PER_PAGE;
  const [totalResult] = await db.select({ count: (0, import_drizzle_orm5.count)() }).from(users);
  const total = totalResult.count;
  const userList = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    avatarUrl: users.avatarUrl,
    createdAt: users.createdAt
  }).from(users).orderBy((0, import_drizzle_orm5.desc)(users.createdAt)).limit(PER_PAGE).offset(offset);
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = total > 0 ? offset + 1 : null;
  const to = total > 0 ? Math.min(offset + PER_PAGE, total) : null;
  const pagination = {
    current_page: page,
    last_page: lastPage,
    per_page: PER_PAGE,
    total,
    from,
    to
  };
  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatar_url: u.avatarUrl,
      created_at: u.createdAt
    })),
    pagination
  });
}

// src/routes/users.ts
var usersRoute = new import_hono2.Hono();
usersRoute.get("/", authMiddleware, index);
var users_default = usersRoute;

// src/routes/qrcodes.ts
var import_hono3 = require("hono");

// src/controllers/qrcodes.controller.ts
var import_drizzle_orm6 = require("drizzle-orm");

// src/services/qrcode.service.ts
var import_qrcode = __toESM(require("qrcode"), 1);
var import_node_crypto2 = __toESM(require("node:crypto"), 1);

// src/services/storage.service.ts
var import_client_s32 = require("@aws-sdk/client-s3");

// src/config/storage.ts
var import_client_s3 = require("@aws-sdk/client-s3");
var s3Client = new import_client_s3.S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE
});
async function ensureBucket() {
  try {
    await s3Client.send(new import_client_s3.HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    console.log(`Bucket "${env.S3_BUCKET}" already exists.`);
  } catch {
    console.log(`Creating bucket "${env.S3_BUCKET}"...`);
    await s3Client.send(new import_client_s3.CreateBucketCommand({ Bucket: env.S3_BUCKET }));
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicRead",
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${env.S3_BUCKET}/*`]
        }
      ]
    };
    await s3Client.send(
      new import_client_s3.PutBucketPolicyCommand({
        Bucket: env.S3_BUCKET,
        Policy: JSON.stringify(policy)
      })
    );
    console.log(`Bucket "${env.S3_BUCKET}" created with public read policy.`);
  }
}

// src/services/storage.service.ts
async function uploadFile(key, body, contentType) {
  await s3Client.send(
    new import_client_s32.PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}
function getFileUrl(fileName) {
  return `${env.STORAGE_URL_BASE}/${fileName}`;
}

// src/services/qrcode.service.ts
async function generateAndUpload(data, userId) {
  const buffer = await import_qrcode.default.toBuffer(data, {
    type: "png",
    width: 300,
    margin: 1
  });
  const timestamp2 = Math.floor(Date.now() / 1e3);
  const uniqId = import_node_crypto2.default.randomBytes(4).toString("hex");
  const fileName = `${userId}_${timestamp2}_${uniqId}.png`;
  await uploadFile(fileName, buffer, "image/png");
  return fileName;
}

// src/controllers/qrcodes.controller.ts
var PER_PAGE2 = 50;
async function index2(c) {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const offset = (page - 1) * PER_PAGE2;
  const [totalResult] = await db.select({ count: (0, import_drizzle_orm6.count)() }).from(qrCodes);
  const total = totalResult.count;
  const rows = await db.select({
    id: qrCodes.id,
    userId: qrCodes.userId,
    fileName: qrCodes.fileName,
    data: qrCodes.data,
    status: qrCodes.status,
    createdAt: qrCodes.createdAt,
    updatedAt: qrCodes.updatedAt,
    userName: users.name,
    userEmail: users.email
  }).from(qrCodes).leftJoin(users, (0, import_drizzle_orm6.eq)(qrCodes.userId, users.id)).orderBy((0, import_drizzle_orm6.desc)(qrCodes.createdAt)).limit(PER_PAGE2).offset(offset);
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE2));
  const from = total > 0 ? offset + 1 : null;
  const to = total > 0 ? Math.min(offset + PER_PAGE2, total) : null;
  const pagination = {
    current_page: page,
    last_page: lastPage,
    per_page: PER_PAGE2,
    total,
    from,
    to
  };
  return c.json({
    qrcodes: rows.map((row) => ({
      id: row.id,
      user_id: row.userId,
      user: {
        id: row.userId,
        name: row.userName,
        email: row.userEmail
      },
      file_name: row.fileName,
      url: row.fileName ? getFileUrl(row.fileName) : null,
      data: row.data,
      created_at: row.createdAt,
      updated_at: row.updatedAt
    })),
    pagination
  });
}
async function store(c) {
  const body = await c.req.json();
  const errors = {};
  if (!body.data || typeof body.data !== "string") {
    errors["data"] = ["data \u306F\u5FC5\u9808\u3067\u3059"];
  } else if (body.data.length > 1e3) {
    errors["data"] = ["data \u306F1000\u6587\u5B57\u4EE5\u4E0B\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"];
  }
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "\u30D0\u30EA\u30C7\u30FC\u30B7\u30E7\u30F3\u30A8\u30E9\u30FC", messages: errors }, 422);
  }
  const user = c.get("user");
  try {
    const fileName = await generateAndUpload(body.data, user.id);
    const [result] = await db.insert(qrCodes).values({
      userId: user.id,
      fileName,
      data: body.data,
      status: "completed"
    }).$returningId();
    const [qrCode] = await db.select().from(qrCodes).where((0, import_drizzle_orm6.eq)(qrCodes.id, result.id)).limit(1);
    return c.json(
      {
        message: "QR\u30B3\u30FC\u30C9\u3092\u751F\u6210\u3057\u307E\u3057\u305F",
        qrcode: {
          id: qrCode.id,
          user_id: qrCode.userId,
          file_name: qrCode.fileName,
          data: qrCode.data,
          status: qrCode.status,
          created_at: qrCode.createdAt,
          updated_at: qrCode.updatedAt,
          url: getFileUrl(qrCode.fileName)
        }
      },
      201
    );
  } catch (error) {
    console.error("QR code generation error:", error);
    return c.json(
      {
        error: "QR\u30B3\u30FC\u30C9\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
}
async function storeAsync(c) {
  const body = await c.req.json();
  const errors = {};
  if (!body.data || typeof body.data !== "string") {
    errors["data"] = ["data \u306F\u5FC5\u9808\u3067\u3059"];
  } else if (body.data.length > 1e3) {
    errors["data"] = ["data \u306F1000\u6587\u5B57\u4EE5\u4E0B\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"];
  }
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "\u30D0\u30EA\u30C7\u30FC\u30B7\u30E7\u30F3\u30A8\u30E9\u30FC", messages: errors }, 422);
  }
  const user = c.get("user");
  const [result] = await db.insert(qrCodes).values({
    userId: user.id,
    fileName: "",
    data: body.data,
    status: "pending"
  }).$returningId();
  (async () => {
    try {
      const fileName = await generateAndUpload(body.data, user.id);
      await db.update(qrCodes).set({ fileName, status: "completed" }).where((0, import_drizzle_orm6.eq)(qrCodes.id, result.id));
    } catch (error) {
      console.error("Async QR code generation error:", error);
      await db.update(qrCodes).set({ status: "failed" }).where((0, import_drizzle_orm6.eq)(qrCodes.id, result.id));
    }
  })();
  return c.json(
    {
      message: "QR\u30B3\u30FC\u30C9\u751F\u6210\u30B8\u30E7\u30D6\u3092\u30AD\u30E5\u30FC\u306B\u6295\u5165\u3057\u307E\u3057\u305F",
      qrcode: {
        id: result.id,
        status: "pending",
        data: body.data,
        created_at: /* @__PURE__ */ new Date()
      }
    },
    202
  );
}
async function status(c) {
  const id = parseInt(c.req.param("id") ?? "0", 10);
  const [qrCode] = await db.select().from(qrCodes).where((0, import_drizzle_orm6.eq)(qrCodes.id, id)).limit(1);
  if (!qrCode) {
    return c.json({ error: "QR\u30B3\u30FC\u30C9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
  }
  const response = {
    id: qrCode.id,
    status: qrCode.status,
    data: qrCode.data,
    created_at: qrCode.createdAt,
    updated_at: qrCode.updatedAt
  };
  if (qrCode.status === "completed" && qrCode.fileName) {
    response.url = getFileUrl(qrCode.fileName);
    response.file_name = qrCode.fileName;
  }
  return c.json(response);
}

// src/routes/qrcodes.ts
var qrcodes = new import_hono3.Hono();
qrcodes.use("*", authMiddleware);
qrcodes.get("/", index2);
qrcodes.post("/", store);
qrcodes.post("/async", storeAsync);
qrcodes.get("/:id/status", status);
var qrcodes_default = qrcodes;

// src/routes/mail.ts
var import_hono4 = require("hono");

// src/config/mail.ts
var import_nodemailer = __toESM(require("nodemailer"), 1);
var transporter = import_nodemailer.default.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE
});

// src/services/mail.service.ts
async function sendMail(to, subject, body) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8f9fa; border-radius: 8px; padding: 30px;">
        <h2 style="color: #333; margin-top: 0;">${subject}</h2>
        <div style="color: #555; line-height: 1.6;">${body}</div>
      </div>
      <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">
        This email was sent from the application.
      </p>
    </body>
    </html>
  `;
  await transporter.sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    html
  });
}

// src/controllers/mail.controller.ts
async function send(c) {
  const body = await c.req.json();
  const errors = {};
  if (!body.to || typeof body.to !== "string") {
    errors["to"] = ["to \u306F\u5FC5\u9808\u3067\u3059"];
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to)) {
    errors["to"] = ["\u6709\u52B9\u306A\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"];
  }
  if (!body.subject || typeof body.subject !== "string") {
    errors["subject"] = ["subject \u306F\u5FC5\u9808\u3067\u3059"];
  } else if (body.subject.length > 255) {
    errors["subject"] = ["subject \u306F255\u6587\u5B57\u4EE5\u4E0B\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"];
  }
  if (!body.message || typeof body.message !== "string") {
    errors["message"] = ["message \u306F\u5FC5\u9808\u3067\u3059"];
  } else if (body.message.length > 5e3) {
    errors["message"] = ["message \u306F5000\u6587\u5B57\u4EE5\u4E0B\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"];
  }
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "\u30D0\u30EA\u30C7\u30FC\u30B7\u30E7\u30F3\u30A8\u30E9\u30FC", messages: errors }, 422);
  }
  try {
    await sendMail(body.to, body.subject, body.message);
    return c.json({ message: "\u30E1\u30FC\u30EB\u3092\u9001\u4FE1\u3057\u307E\u3057\u305F" });
  } catch (error) {
    console.error("Mail send error:", error);
    return c.json(
      {
        error: "\u30E1\u30FC\u30EB\u306E\u9001\u4FE1\u306B\u5931\u6557\u3057\u307E\u3057\u305F",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      500
    );
  }
}

// src/routes/mail.ts
var mail = new import_hono4.Hono();
mail.post("/send", authMiddleware, send);
var mail_default = mail;

// src/routes/health.ts
var import_hono5 = require("hono");
var health = new import_hono5.Hono();
health.get("/", (c) => c.json({ status: "ok" }));
var health_default = health;

// src/routes/index.ts
var api = new import_hono6.Hono();
api.route("/auth", auth_default);
api.route("/users", users_default);
api.route("/qrcodes", qrcodes_default);
api.route("/mail", mail_default);
api.route("/health", health_default);
var routes_default = api;

// src/app.ts
var app = new import_hono7.Hono();
app.use("*", (0, import_logger.logger)());
app.use(
  "/api/*",
  (0, import_cors.cors)({
    origin: env.FRONTEND_URL,
    credentials: true
  })
);
app.use("/api/*", sessionMiddleware);
app.route("/api", routes_default);
var app_default = app;

// src/index.ts
async function main() {
  try {
    await ensureBucket();
    console.log("S3 bucket initialized.");
  } catch (error) {
    console.warn("Failed to initialize S3 bucket (will retry on use):", error);
  }
  (0, import_node_server.serve)(
    {
      fetch: app_default.fetch,
      port: env.PORT
    },
    (info) => {
      console.log(`Server is running on http://localhost:${info.port}`);
    }
  );
}
main();
