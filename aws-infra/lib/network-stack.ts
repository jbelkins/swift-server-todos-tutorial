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

    // VPC across 2 AZs. Public subnets host the ALB. Private-isolated
    // subnets host the ECS tasks and Aurora. No NAT gateway. Egress to
    // AWS APIs is provided by VPC endpoints below.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Chained security groups: ALB -> tasks (:8080) -> Aurora (:5432).
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'ALB ingress from the internet on port 80',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP from the internet',
    );

    this.tasksSecurityGroup = new ec2.SecurityGroup(this, 'TasksSecurityGroup', {
      vpc: this.vpc,
      description: 'ECS tasks ingress from the ALB on port 8080',
      allowAllOutbound: true,
    });
    this.tasksSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(8080),
      'From ALB to task container',
    );

    this.auroraSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSecurityGroup', {
      vpc: this.vpc,
      description: 'Aurora ingress from ECS tasks on port 5432',
      allowAllOutbound: true,
    });
    this.auroraSecurityGroup.addIngressRule(
      this.tasksSecurityGroup,
      ec2.Port.tcp(5432),
      'From ECS tasks to Aurora',
    );

    // Interface endpoints let Fargate pull images, ship logs, and read
    // secrets without a NAT. Gateway endpoint for S3 covers ECR layer
    // downloads (ECR stores image layers in S3).
    const privateSubnets = { subnets: this.vpc.isolatedSubnets };

    this.vpc.addInterfaceEndpoint('EcrApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      subnets: privateSubnets,
    });
    this.vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: privateSubnets,
    });
    this.vpc.addInterfaceEndpoint('LogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: privateSubnets,
    });
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: privateSubnets,
    });
    this.vpc.addInterfaceEndpoint('StsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.STS,
      subnets: privateSubnets,
    });

    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    // VPC Block Public Access is an account-and-region-wide setting. When its
    // InternetGatewayBlockMode is `block-ingress` or `block-bidirectional`,
    // inbound traffic is dropped at the internet gateway before it reaches the
    // ALB. The symptom is confusing: the target group reports healthy targets
    // and every security group, route table, and NACL checks out, but requests
    // time out and the load balancer records no connections at all.
    //
    // The exclusion below re-opens the gateway for this VPC only, leaving the
    // account-wide setting untouched. It defaults to on via `allowVpcIngress`
    // in cdk.json, and creating it requires
    // `ec2:CreateVpcBlockPublicAccessExclusion` on the deploy role. Accounts
    // with BPA off -- the default -- do not need the exclusion; opt out with
    // `-c allowVpcIngress=false` or by editing cdk.json.
    //
    // Diagnose with:
    //   aws ec2 describe-vpc-block-public-access-options --region <region>
    //
    // The comparison accepts a boolean and a string because cdk.json context
    // is parsed as JSON (`true`) while `-c allowVpcIngress=true` on the
    // command line always arrives as the string `'true'`.
    const allowVpcIngress = this.node.tryGetContext('allowVpcIngress');
    if (allowVpcIngress === true || allowVpcIngress === 'true') {
      new ec2.CfnVPCBlockPublicAccessExclusion(this, 'IgwIngressExclusion', {
        vpcId: this.vpc.vpcId,
        // `allow-egress` is not enough; inbound requires bidirectional.
        internetGatewayExclusionMode: 'allow-bidirectional',
      });
    }

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
  }
}
