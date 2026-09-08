#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { ServiceStack } from '../lib/service-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

// Region is pinned explicitly. The workshop standardizes on us-east-1.
// Override with CDK_DEFAULT_REGION if attendees deploy elsewhere.
const env = {
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

// Fixed names so PipelineStack, ServiceStack, and any external tooling
// agree on where the pipeline pushes and what ECS resource to update.
const ECR_REPOSITORY_NAME = 'swift-todos';
const ECS_CLUSTER_NAME = 'swift-todos-cluster';
const ECS_SERVICE_NAME = 'swift-todos-service';

// PipelineStack is intentionally free of cross-stack references so the
// tutorial can deploy it on its own before any other resource exists.
new PipelineStack(app, 'PipelineStack', {
  env,
  ecsClusterName: ECS_CLUSTER_NAME,
  ecsServiceName: ECS_SERVICE_NAME,
});

const network = new NetworkStack(app, 'NetworkStack', { env });

const database = new DatabaseStack(app, 'DatabaseStack', {
  env,
  vpc: network.vpc,
  auroraSecurityGroup: network.auroraSecurityGroup,
});

new ServiceStack(app, 'ServiceStack', {
  env,
  vpc: network.vpc,
  tasksSecurityGroup: network.tasksSecurityGroup,
  albSecurityGroup: network.albSecurityGroup,
  dbCluster: database.cluster,
  dbSecret: database.secret,
  ecrRepositoryName: ECR_REPOSITORY_NAME,
  ecsClusterName: ECS_CLUSTER_NAME,
  ecsServiceName: ECS_SERVICE_NAME,
});

app.synth();
