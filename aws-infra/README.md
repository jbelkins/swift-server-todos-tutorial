# aws-infra

CDK v2 (TypeScript) app that deploys the Swift Server Todos workshop on AWS. Four stacks, one deploy command, one destroy command. Region is `us-east-1` throughout.

## Stacks

1. `NetworkStack`. VPC across 2 AZs. Public subnets host the ALB. Private-isolated subnets host ECS tasks and Aurora. No NAT gateway. Interface VPC endpoints for ECR (api + dkr), CloudWatch Logs, Secrets Manager, and STS. Gateway VPC endpoint for S3. Three chained security groups: internet to ALB on :80, ALB to tasks on :8080, tasks to Aurora on :5432.
2. `DatabaseStack`. Aurora Serverless v2 Postgres 16 cluster with one writer. `serverlessV2MinCapacity: 0.5`, `serverlessV2MaxCapacity: 2.0`. Credentials generated into Secrets Manager. Cluster attached to the Aurora security group from `NetworkStack`.
3. `ServiceStack`. ECR repository `swift-todos`. ECS cluster on Fargate. Task definition 1 vCPU / 2 GB, ARM64, container port 8080, `/health` health check. ALB in public subnets forwarding :80 to :8080. Task role has read access to the DB secret. Env vars: `AWS_REGION`, plus `DB_HOST` / `DB_USER` / `DB_PASS` / `DB_NAME` from the secret. CloudWatch log group with 7-day retention.
4. `PipelineStack`. CodeBuild project on `LinuxBuildImage.STANDARD_7_0` with Docker privileged mode. Source is a GitHub webhook against the attendee's fork of `swift-server-todos-tutorial`. `buildspec.yml` at the repo root drives the build. IAM role has ECR push and ECS `UpdateService` permissions.

## Prerequisites

- Node 20
- AWS CDK v2 CLI (`npm install -g aws-cdk` if not already installed)
- AWS credentials for a target account, with permission to deploy VPC, ECS, RDS, ECR, CodeBuild, IAM

## Bootstrap

Run once per account and region:

```
cdk bootstrap aws://ACCOUNT/us-east-1
```

Find your account id with:

```
aws sts get-caller-identity --query Account --output text
```

## Deploy

Deploy order matters: Network first, then Database, then Service, then Pipeline. The single command below respects the dependency order automatically:

```
cdk deploy NetworkStack DatabaseStack ServiceStack PipelineStack --region us-east-1
```

Before deploying `PipelineStack`, edit `lib/pipeline-stack.ts` and replace `ATTENDEE_GITHUB_USER` with the GitHub owner of the fork the pipeline should build.

## Outputs

- `NetworkStack.VpcId`
- `DatabaseStack.ClusterEndpoint`, `DatabaseStack.ClusterSecretArn`
- `ServiceStack.AlbDnsName`, `ServiceStack.EcrRepositoryUri`
- `PipelineStack.BuildProjectName`

Use the ALB DNS name to hit the API. The ECR repository URI is what CodeBuild pushes to. The secret ARN is where the app reads database credentials from.

## Destroy

```
cdk destroy NetworkStack DatabaseStack ServiceStack PipelineStack --region us-east-1
```

Aurora Serverless v2 minimum ACU is charged even when the app is idle. Interface VPC endpoints are billed per-endpoint per hour. Destroy the stacks when the workshop is done.

## Local iteration

```
npm install
npx cdk synth --region us-east-1
```

`cdk synth` emits CloudFormation to `cdk.out/`. No AWS calls needed for a local synth.
