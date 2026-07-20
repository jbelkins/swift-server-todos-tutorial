import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface DatabaseStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly auroraSecurityGroup: ec2.ISecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Aurora Serverless v2 Postgres. Min ACU 0.5 scales down to control
    // idle cost. TLS is on by default and cannot be disabled.
    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_13,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('todos_admin'),
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2.0,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.auroraSecurityGroup],
      defaultDatabaseName: 'todos',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.secret = this.cluster.secret!;
    // ...
  }
}
