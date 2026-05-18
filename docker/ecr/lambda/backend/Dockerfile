FROM public.ecr.aws/lambda/nodejs:22 AS builder

WORKDIR /build

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
# build:lambda は tsc --noEmit && esbuild ... なので、
# 型エラーがあればここでビルドが中断され、イメージは作られない
RUN npm run build:lambda

FROM public.ecr.aws/lambda/nodejs:22

# LAMBDA_TASK_ROOT は AWS Lambda ベースイメージに定義済みの環境変数（値は /var/task）
# Lambda ランタイムはこのディレクトリからハンドラーコードを読み込む
COPY --from=builder /build/dist/lambda.js ${LAMBDA_TASK_ROOT}/lambda.js
COPY --from=builder /build/dist/sqs-handler.js ${LAMBDA_TASK_ROOT}/sqs-handler.js
COPY --from=builder /build/dist/db-task.js ${LAMBDA_TASK_ROOT}/db-task.js
COPY --from=builder /build/dist/daily-report.js ${LAMBDA_TASK_ROOT}/daily-report.js
COPY --from=builder /build/dist/notifications-email.js ${LAMBDA_TASK_ROOT}/notifications-email.js

# マイグレーション SQL ファイル（migrate.ts が参照する）
COPY --from=builder /build/src/db/migrations/ ${LAMBDA_TASK_ROOT}/db/migrations/

CMD ["lambda.handler"]
