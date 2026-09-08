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

    // Aurora Serverless v2 Postgres. `serverlessV2MinCapacity: 0` enables
    // scale-to-zero: the cluster auto-pauses after a period of no
    // connections and bills $0 while paused. The first query after a
    // pause pays a ~15s cold-start warm-up. TLS is on by default and
    // cannot be disabled. Available on Aurora PostgreSQL 13.15+, 14.12+,
    // 15.7+, and 16.3+ (we run 16.13).
    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_13,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('todos_admin'),
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2.0,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.auroraSecurityGroup],
      defaultDatabaseName: 'todos',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // The generated secret is guaranteed to exist for a cluster that
    // used Credentials.fromGeneratedSecret.
    this.secret = this.cluster.secret!;

    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
    });
    new cdk.CfnOutput(this, 'ClusterSecretArn', {
      value: this.secret.secretArn,
    });
  }
}
