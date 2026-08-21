#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EggDrop3DStack } from "../lib/egg-drop-3d-stack.js";

const app = new cdk.App();
const stackName = process.env.STACK_NAME ?? "EggDrop3DStack";
const region =
  process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1";

new EggDrop3DStack(app, stackName, {
  stackName,
  description: "Egg Drop 3D web hosting, API, and rate-limit storage",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
});
