import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { EggDrop3DStack } from "../lib/egg-drop-3d-stack.js";

function synthTemplate(): Template {
  const app = new cdk.App();
  const stack = new EggDrop3DStack(app, "TestStack", {
    apiCode: lambda.Code.fromInline(
      "exports.handler = async () => ({ statusCode: 200, body: 'ok' });",
    ),
  });
  return Template.fromStack(stack);
}

describe("EggDrop3DStack", () => {
  it("creates retained private storage with rate-row TTL", () => {
    const template = synthTemplate();

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      },
    });
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: Match.arrayWith([
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ]),
        TimeToLiveSpecification: {
          AttributeName: "ttl",
          Enabled: true,
        },
      },
    });
  });

  it("runs the API on Node.js 24 ARM64 with its table injected", () => {
    const template = synthTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Architectures: ["arm64"],
      Handler: "lambda.handler",
      Runtime: "nodejs24.x",
      Environment: {
        Variables: {
          NODE_OPTIONS: "--enable-source-maps",
          TABLE_NAME: Match.anyValue(),
        },
      },
    });
    template.hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "AWS_IAM",
      InvokeMode: "BUFFERED",
    });
  });

  it("uses signed OACs for both private origins", () => {
    const template = synthTemplate();
    const controls = Object.values(
      template.findResources("AWS::CloudFront::OriginAccessControl"),
    );
    const originTypes = controls.map(
      (resource) =>
        resource.Properties.OriginAccessControlConfig.OriginAccessControlOriginType,
    );

    assert.deepEqual(originTypes.sort(), ["lambda", "s3"]);
    for (const resource of controls) {
      assert.equal(
        resource.Properties.OriginAccessControlConfig.SigningBehavior,
        "always",
      );
      assert.equal(
        resource.Properties.OriginAccessControlConfig.SigningProtocol,
        "sigv4",
      );
    }
  });

  it("keeps API paths uncached and limits SPA rewriting to static routes", () => {
    const template = synthTemplate();
    const distributions = Object.values(
      template.findResources("AWS::CloudFront::Distribution"),
    );
    assert.equal(distributions.length, 1);

    const config = distributions[0]?.Properties.DistributionConfig;
    assert.ok(config);
    assert.equal(config.DefaultCacheBehavior.FunctionAssociations.length, 1);

    const behaviors = config.CacheBehaviors as Array<Record<string, unknown>>;
    const apiBehaviors = behaviors.filter((behavior) =>
      String(behavior.PathPattern).startsWith("/api"),
    );
    assert.deepEqual(
      apiBehaviors.map((behavior) => behavior.PathPattern).sort(),
      ["/api", "/api/*"],
    );
    for (const behavior of apiBehaviors) {
      assert.equal(behavior.FunctionAssociations, undefined);
      assert.deepEqual(behavior.AllowedMethods, [
        "GET",
        "HEAD",
        "OPTIONS",
        "PUT",
        "PATCH",
        "POST",
        "DELETE",
      ]);
      assert.ok(behavior.CachePolicyId);
      assert.ok(behavior.OriginRequestPolicyId);
    }
  });

  it("grants CloudFront both Function URL invocation permissions", () => {
    const template = synthTemplate();
    const permissions = Object.values(
      template.findResources("AWS::Lambda::Permission"),
    );
    const cloudFrontPermissions = permissions.filter(
      (resource) => resource.Properties.Principal === "cloudfront.amazonaws.com",
    );
    const actions = cloudFrontPermissions.map(
      (resource) => resource.Properties.Action,
    );

    assert.ok(actions.includes("lambda:InvokeFunctionUrl"));
    assert.ok(actions.includes("lambda:InvokeFunction"));
    for (const resource of cloudFrontPermissions) {
      assert.ok(resource.Properties.SourceArn);
    }

    const invokeFunctionPermission = cloudFrontPermissions.find(
      (resource) => resource.Properties.Action === "lambda:InvokeFunction",
    );
    assert.equal(invokeFunctionPermission?.Properties.InvokedViaFunctionUrl, true);
  });
});
