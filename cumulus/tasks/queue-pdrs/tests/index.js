/* eslint-disable no-param-reassign */
'use strict';

import test from 'ava';
import MockAWS from '@mapbox/mock-aws-sdk-js';

import { s3, sqs, recursivelyDeleteS3Bucket } from '@cumulus/common/aws';
import testUtils from '@cumulus/common/test-utils';

import { handler } from '../index';
import inputJSON from './fixtures/input.json';
import workflowTemplate from './fixtures/workflow-template.json';

const aws = require('@cumulus/common/aws');

test.beforeEach(async (t) => {
  t.context.bucket = testUtils.randomString();
  await sqs().createQueue({ QueueName: 'testQueue' }).promise();
  return s3().createBucket({ Bucket: t.context.bucket }).promise();
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.bucket);
  await sqs().deleteQueue({ QueueUrl: `http://${process.env.LOCALSTACK_HOST}:4576/queue/testQueue` }).promise();
});

test('queue pdrs', async (t) => {
  const Bucket = t.context.bucket;
  const ParsePdrTemplate = `s3://${Bucket}/dev/workflows/ParsePdr.json`;

  await aws.s3().putObject({
    Bucket,
    Key: 'dev/workflows/ParsePdr.json',
    Body: JSON.stringify(workflowTemplate)
  }).promise();

  MockAWS.stub('StepFunctions', 'describeExecution').returns({
    promise: () => Promise.resolve({})
  });

  const input = Object.assign({}, inputJSON);
  input.config.templates.ParsePdr = ParsePdrTemplate;
  input.config.buckets.internal = t.context.bucket;
  input.config.queues.startSF = `http://${process.env.LOCALSTACK_HOST}:4576/queue/testQueue`;

  return handler(input, {}, (e, output) => {
    t.ifError(e);
    t.is(typeof output, 'object');
    t.is(output.pdrs_queued, 2);
    MockAWS.StepFunctions.restore();
  });
});