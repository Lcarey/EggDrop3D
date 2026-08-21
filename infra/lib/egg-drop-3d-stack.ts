import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ArnFormat,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface EggDrop3DStackProps extends StackProps {
  /** Override used by assertion tests so they do not require a built API asset. */
  readonly apiCode?: lambda.Code;
}

export class EggDrop3DStack extends Stack {
  constructor(scope: Construct, id: string, props: EggDrop3DStackProps = {}) {
    super(scope, id, props);

    const rateTable = new dynamodb.Table(this, "RateTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const apiBundlePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "apps",
      "api",
      "dist",
    );

    const apiFunction = new lambda.Function(this, "ApiFunction", {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      code: props.apiCode ?? lambda.Code.fromAsset(apiBundlePath),
      handler: "lambda.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        TABLE_NAME: rateTable.tableName,
      },
    });
    rateTable.grantReadWriteData(apiFunction);

    const functionUrl = apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    const webBucket = new s3.Bucket(this, "WebBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(webBucket);
    const functionUrlOac = new cloudfront.FunctionUrlOriginAccessControl(
      this,
      "FunctionUrlOac",
      {
        description: "Signs CloudFront requests to the private Egg Drop API",
        signing: cloudfront.Signing.SIGV4_ALWAYS,
      },
    );
    const apiOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(
      functionUrl,
      { originAccessControl: functionUrlOac },
    );

    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      comment: "Serve index.html for extensionless client-side routes",
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.method === "GET" || request.method === "HEAD") {
    var uri = request.uri;
    var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
    if (lastSegment.indexOf(".") === -1) {
      request.uri = "/index.html";
    }
  }
  return request;
}
      `),
    });

    const entryPointCachePolicy = new cloudfront.CachePolicy(
      this,
      "EntryPointCachePolicy",
      {
        comment: "Near-zero cache for the SPA shell and other mutable files",
        defaultTtl: Duration.seconds(1),
        minTtl: Duration.seconds(1),
        maxTtl: Duration.seconds(1),
        enableAcceptEncodingBrotli: true,
        enableAcceptEncodingGzip: true,
      },
    );

    const immutableAssetCachePolicy = new cloudfront.CachePolicy(
      this,
      "ImmutableAssetCachePolicy",
      {
        comment: "Long-lived cache for Vite content-hashed assets",
        defaultTtl: Duration.days(365),
        minTtl: Duration.days(30),
        maxTtl: Duration.days(365),
        enableAcceptEncodingBrotli: true,
        enableAcceptEncodingGzip: true,
      },
    );

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Keep x-amz-content-sha256, X-Edit-Token, content headers, cookies,
      // and query strings. Host must be replaced with the Function URL host;
      // Authorization is intentionally replaced by the OAC SigV4 signature.
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
    };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Egg Drop 3D web app and same-origin API",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: staticOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: entryPointCachePolicy,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [
          {
            function: spaRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/assets/*": {
          origin: staticOrigin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: immutableAssetCachePolicy,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          compress: true,
        },
        "/api": apiBehavior,
        "/api/*": apiBehavior,
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // Function URL dual authorization requires both permissions. The current
    // FunctionUrlOrigin L2 supplies InvokeFunctionUrl; add the URL-restricted
    // InvokeFunction permission explicitly for the post-2025 authorization model.
    const distributionArn = Stack.of(this).formatArn({
      service: "cloudfront",
      region: "",
      resource: "distribution",
      resourceName: distribution.distributionId,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    new lambda.CfnPermission(this, "AllowCloudFrontInvokeFunction", {
      action: "lambda:InvokeFunction",
      functionName: apiFunction.functionName,
      principal: "cloudfront.amazonaws.com",
      sourceArn: distributionArn,
      invokedViaFunctionUrl: true,
    });

    new CfnOutput(this, "AppUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "BucketName", { value: webBucket.bucketName });
    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "FunctionUrl", { value: functionUrl.url });
    new CfnOutput(this, "TableName", { value: rateTable.tableName });
  }
}
