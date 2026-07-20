import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface PipelineStackProps extends cdk.StackProps {
  // Name of the ECS cluster and service the pipeline will trigger a
  // deployment on. `ServiceStack` creates them later with these exact
  // names. Passing them as strings avoids a cross-stack dependency on
  // stacks that do not exist yet.
  readonly ecsClusterName: string;
  readonly ecsServiceName: string;
}

export class PipelineStack extends cdk.Stack {
  public readonly ecrRepository: ecr.Repository;
  public readonly repository: codecommit.Repository;
  public readonly project: codebuild.Project;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // The ECR repository lives in this stack so the pipeline can be
    // deployed and produce a first image before any other stack exists.
    this.ecrRepository = new ecr.Repository(this, 'EcrRepository', {
      repositoryName: 'swift-todos',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // Source lives in AWS CodeCommit. Attendees push their working copy
    // to this repository. CodeBuild pulls from it via IAM, no external
    // token or GitHub authorization needed.
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
        // Native ARM64 build agent. Matches the target image architecture
        // so `docker buildx build --platform linux/arm64` runs natively
        // rather than under QEMU (which fails with "exec format error"
        // on cross-arch CodeBuild agents).
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
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

    // Trigger the CodeBuild project on every push to `main`. The L2
    // codebuild.Source.codeCommit construct wires the CodeCommit trigger
    // when notifyOnPushRule is enabled below.
    this.repository.onCommit('OnMainCommit', {
      target: new events_targets.CodeBuildProject(this.project),
      branches: ['main'],
    });

    // ECR push permissions.
    this.project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );
    this.project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
        ],
        resources: [this.ecrRepository.repositoryArn],
      }),
    );

    // Trigger an ECS deployment after the image is pushed. The service
    // ARN is scoped by cluster and service name so this stack does not
    // depend on ServiceStack existing.
    this.project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ecs',
            resource: 'service',
            resourceName: `${props.ecsClusterName}/${props.ecsServiceName}`,
          }),
        ],
      }),
    );

    new cdk.CfnOutput(this, 'BuildProjectName', {
      value: this.project.projectName,
    });
    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: this.ecrRepository.repositoryUri,
    });
    new cdk.CfnOutput(this, 'RepositoryCloneUrlHttp', {
      value: this.repository.repositoryCloneUrlHttp,
    });
    new cdk.CfnOutput(this, 'RepositoryCloneUrlGrc', {
      value: `codecommit::${cdk.Stack.of(this).region}://${this.repository.repositoryName}`,
      description:
        'Use with git-remote-codecommit. Region is embedded so the URL works regardless of the local AWS profile default.',
    });
  }
}
