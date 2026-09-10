#!/bin/sh
set +e
check() {
  label="$1"; shift
  if "$@" >/dev/null 2>&1; then printf "[OK]   %s\n" "$label"
  else printf "[FAIL] %s\n" "$label"
  fi
}

REGION="us-east-1"

check "AWS CLI"                    command -v aws
check "AWS credentials"            aws sts get-caller-identity
check "Swift 6.3"                  sh -c 'swift --version | grep -q "Swift version 6.3"'
check "Node 20+"                   sh -c 'node -e "process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)"'
check "AWS CDK CLI"                command -v cdk
check "AWS_REGION=us-east-1"       sh -c '[ "$AWS_REGION" = "us-east-1" ]'
check "CDK bootstrap done"         aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION"

echo "Region: $REGION. All [OK] required."

