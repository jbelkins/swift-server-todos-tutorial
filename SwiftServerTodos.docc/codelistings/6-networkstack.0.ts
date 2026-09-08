import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly tasksSecurityGroup: ec2.SecurityGroup;
  public readonly auroraSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // No NAT gateway. Egress to AWS APIs is provided by VPC endpoints below.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Chained: ALB -> tasks (:8080) -> Aurora (:5432).
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
    });
    // ...

    this.tasksSecurityGroup = new ec2.SecurityGroup(this, 'TasksSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
    });
    this.tasksSecurityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(8080));

    this.auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
    });
    this.auroraSecurityGroup.addIngressRule(this.tasksSecurityGroup, ec2.Port.tcp(5432));

    // Interface endpoints replace NAT for Fargate image pulls, logs, secrets.
    const privateSubnets = { subnets: this.vpc.isolatedSubnets };
    this.vpc.addInterfaceEndpoint('EcrApiEndpoint', { service: ec2.InterfaceVpcEndpointAwsService.ECR, subnets: privateSubnets });
    this.vpc.addInterfaceEndpoint('EcrDkrEndpoint', { service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER, subnets: privateSubnets });
    this.vpc.addInterfaceEndpoint('LogsEndpoint', { service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS, subnets: privateSubnets });
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', { service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER, subnets: privateSubnets });
    this.vpc.addInterfaceEndpoint('StsEndpoint', { service: ec2.InterfaceVpcEndpointAwsService.STS, subnets: privateSubnets });

    // S3 gateway endpoint covers ECR layer downloads.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // ...
  }
}
