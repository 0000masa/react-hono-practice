FROM public.ecr.aws/lambda/nodejs:22 AS builder

WORKDIR /build

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build:lambda

FROM public.ecr.aws/lambda/nodejs:22

# LAMBDA_TASK_ROOT は AWS Lambda ベースイメージに定義済みの環境変数（値は /var/task）
# Lambda ランタイムはこのディレクトリからハンドラーコードを読み込む
COPY --from=builder /build/dist/lambda.js ${LAMBDA_TASK_ROOT}/lambda.js

CMD ["lambda.handler"]
