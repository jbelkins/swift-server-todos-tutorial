import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface ServiceStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly tasksSecurityGroup: ec2.ISecurityGroup;
  readonly albSecurityGroup: ec2.ISecurityGroup;
  readonly dbSecret: secretsmanager.ISecret;
  readonly ecrRepositoryName: string;
  readonly ecsClusterName: string;
  readonly ecsServiceName: string;
}

export class ServiceStack extends cdk.Stack {
  public readonly ecrRepository: ecr.IRepository;
  public readonly ecsCluster: ecs.Cluster;
  public readonly ecsService: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    this.ecrRepository = ecr.Repository.fromRepositoryName(this, 'EcrRepository', props.ecrRepositoryName);
    this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', { clusterName: props.ecsClusterName, vpc: props.vpc });
    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', { retention: logs.RetentionDays.ONE_WEEK });

    // 1 vCPU / 2 GB, ARM64 (Graviton) for Swift on Linux.
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });

    // The app builds POSTGRES_URL at startup from DB_HOST / DB_USER / DB_PASS / DB_NAME.
    const container = taskDefinition.addContainer('SwiftTodos', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'swift-todos', logGroup }),
      environment: { AWS_REGION: cdk.Stack.of(this).region },
      secrets: {
        DB_HOST: ecs.Secret.fromSecretsManager(props.dbSecret, 'host'),
        DB_USER: ecs.Secret.fromSecretsManager(props.dbSecret, 'username'),
        DB_PASS: ecs.Secret.fromSecretsManager(props.dbSecret, 'password'),
        DB_NAME: ecs.Secret.fromSecretsManager(props.dbSecret, 'dbname'),
      },
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      // ...
    });
    props.dbSecret.grantRead(taskDefinition.taskRole);

    this.ecsService = new ecs.FargateService(this, 'FargateService', {
      serviceName: props.ecsServiceName,
      cluster: this.ecsCluster,
      taskDefinition,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.tasksSecurityGroup],
    });

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSecurityGroup as ec2.SecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // The workshop uses plain HTTP on :80 because attendees do not own
    // a shared domain to attach an ACM certificate to. In a real
    // deployment, terminate TLS on the ALB with a :443 listener:
    //
    //   const cert = acm.Certificate.fromCertificateArn(
    //     this, 'AlbCert', 'arn:aws:acm:us-east-1:ACCOUNT:certificate/...'
    //   );
    //   const httpsListener = this.loadBalancer.addListener('HttpsListener', {
    //     port: 443,
    //     protocol: elbv2.ApplicationProtocol.HTTPS,
    //     certificates: [cert],
    //     open: false,
    //   });
    //   httpsListener.addTargets(...);   // same target group as below
    //   this.loadBalancer.addListener('HttpRedirect', {
    //     port: 80,
    //     protocol: elbv2.ApplicationProtocol.HTTP,
    //     defaultAction: elbv2.ListenerAction.redirect({
    //       protocol: 'HTTPS', port: '443', permanent: true,
    //     }),
    //   });
    const listener = this.loadBalancer.addListener('HttpListener', {
      port: 80, protocol: elbv2.ApplicationProtocol.HTTP, open: false,
    });
    listener.addTargets('EcsTargets', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.ecsService.loadBalancerTarget({ containerName: container.containerName, containerPort: 8080 })],
      healthCheck: { path: '/health', healthyHttpCodes: '200' },
    });
    // ...
  }
}
