#!/usr/bin/env bash
# Build once, deploy infrastructure, and publish the web bundle to S3.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

STACK_NAME=${STACK_NAME:-EggDrop3DStack}
REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}
OUTPUTS_FILE="$PROJECT_ROOT/infra/cdk-outputs.json"
WEB_DIST="$PROJECT_ROOT/apps/web/dist"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' was not found." >&2
    exit 1
  fi
}

require_command node
require_command npm
require_command aws

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if (( NODE_MAJOR < 22 )); then
  echo "Error: Node.js 22 or newer is required (found $(node --version))." >&2
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/node_modules/.bin/cdk" ]]; then
  echo "Error: dependencies are not installed. Run 'npm install' first." >&2
  exit 1
fi

echo "Checking AWS credentials in $REGION..."
aws sts get-caller-identity --region "$REGION" >/dev/null

echo "Building shared code, API Lambda, and web app..."
npm run build

if [[ ! -f "$PROJECT_ROOT/apps/api/dist/lambda.mjs" ]]; then
  echo "Error: API build did not create apps/api/dist/lambda.mjs." >&2
  exit 1
fi
if [[ ! -f "$WEB_DIST/index.html" ]]; then
  echo "Error: web build did not create apps/web/dist/index.html." >&2
  exit 1
fi

echo "Deploying CDK stack $STACK_NAME in $REGION..."
STACK_NAME="$STACK_NAME" AWS_REGION="$REGION" \
  npm run deploy -w @eggdrop/infra -- \
  "$STACK_NAME" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE"

stack_output() {
  local output_key=$1
  aws cloudformation describe-stacks \
    --region "$REGION" \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
    --output text
}

BUCKET_NAME=$(stack_output BucketName)
DISTRIBUTION_ID=$(stack_output DistributionId)
APP_URL=$(stack_output AppUrl)

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo "Error: stack output BucketName is missing." >&2
  exit 1
fi
if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "Error: stack output DistributionId is missing." >&2
  exit 1
fi
if [[ -z "$APP_URL" || "$APP_URL" == "None" ]]; then
  echo "Error: stack output AppUrl is missing." >&2
  exit 1
fi

if [[ -d "$WEB_DIST/assets" ]]; then
  echo "Uploading immutable content-hashed assets..."
  aws s3 sync "$WEB_DIST/assets/" "s3://$BUCKET_NAME/assets/" \
    --region "$REGION" \
    --cache-control "public, max-age=31536000, immutable" \
    --delete \
    --only-show-errors
fi

echo "Uploading mutable app entry files..."
aws s3 sync "$WEB_DIST/" "s3://$BUCKET_NAME/" \
  --region "$REGION" \
  --cache-control "public, max-age=0, must-revalidate" \
  --exclude "assets/*" \
  --delete \
  --only-show-errors

echo "Invalidating the SPA entry point..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/" "/index.html" \
  --query "Invalidation.Id" \
  --output text >/dev/null

echo "Deployment complete: $APP_URL"
