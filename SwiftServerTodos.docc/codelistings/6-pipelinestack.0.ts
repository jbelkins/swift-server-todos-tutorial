import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
export interface PipelineStackProps extends cdk.StackProps {
  readonly ecsClusterName: string;
  readonly ecsServiceName: string;
}
export class PipelineStack extends cdk.Stack {
  public readonly ecrRepository: ecr.Repository;
  public readonly repository: codecommit.Repository;
  public readonly project: codebuild.Project;
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    this.ecrRepository = new ecr.Repository(this, 'EcrRepository', {
      repositoryName: 'swift-todos',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });
    // Source lives in AWS CodeCommit. CodeBuild pulls from it via IAM,
    // no external token or GitHub authorization needed.
    this.repository = new codecommit.Repository(this, 'SourceRepository', {
      repositoryName: 'swift-todos',
      description: 'Source for the Swift on AWS workshop',
    });
    const codeCommitSource = codebuild.Source.codeCommit({
      repository: this.repository,
      branchOrRef: 'main',
    });
    this.project = new codebuild.Project(this, 'BuildProject', {
      projectName: 'swift-todos-build',
      source: codeCommitSource,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
      environment: {
        // Native ARM64 agent so `docker build` runs without QEMU emulation.
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        privileged: true,
        computeType: codebuild.ComputeType.LARGE,
      },
      environmentVariables: {
        AWS_REGION: { value: cdk.Stack.of(this).region },
        ECR_REPOSITORY_URI: { value: this.ecrRepository.repositoryUri },
        ECS_CLUSTER_NAME: { value: props.ecsClusterName },
        ECS_SERVICE_NAME: { value: props.ecsServiceName },
      },
    });
    // Trigger the CodeBuild project on every push to `main`.
    this.repository.onCommit('OnMainCommit', {
      target: new events_targets.CodeBuildProject(this.project),
      branches: ['main'],
    });
    // ... IAM policies elided for brevity, see aws-infra/lib/pipeline-stack.ts ...
    new cdk.CfnOutput(this, 'RepositoryCloneUrlGrc', {
      value: `codecommit::${cdk.Stack.of(this).region}://${this.repository.repositoryName}`,
      description: 'Use with git-remote-codecommit.',
    });
  }
}
