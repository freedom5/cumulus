'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('../../../lambdas/bootstrap');
const models = require('../../../models');
const providerEndpoint = require('../../../endpoints/providers');
const {
  fakeUserFactory,
  fakeProviderFactory,
  testEndpoint
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { RecordDoesNotExist } = require('../../../lib/errors');

process.env.UsersTable = randomString();
process.env.ProvidersTable = randomString();
process.env.stackName = randomString();
process.env.internal = randomString();
let providerModel;
const esIndex = randomString();
let esClient;

let authHeaders;
let userModel;

const providerDoesNotExist = async (t, providerId) => {
  const error = await t.throws(providerModel.get({ id: providerId }));
  t.true(error instanceof RecordDoesNotExist);
};

test.before(async () => {
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  providerModel = new models.Provider();
  await providerModel.createTable();

  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  esClient = await Search.es('fakehost');
});

test.beforeEach(async (t) => {
  t.context.testProvider = fakeProviderFactory();
  await providerModel.create(t.context.testProvider);
});

test.after.always(async () => {
  await providerModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const newProvider = fakeProviderFactory();
  const request = {
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify(newProvider)
  };

  return testEndpoint(providerEndpoint, request, async (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
    await providerDoesNotExist(t, newProvider.id);
  });
});

test('CUMULUS-912 POST with an unauthorized user returns an unauthorized response', async (t) => {
  const newProvider = fakeProviderFactory();
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'Bearer invalid-token'
    },
    body: JSON.stringify(newProvider)
  };

  return testEndpoint(providerEndpoint, request, async (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
    await providerDoesNotExist(t, newProvider.id);
  });
});

test('POST with invalid authorization scheme returns an invalid authorization response', (t) => {
  const newProvider = fakeProviderFactory();
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'InvalidBearerScheme ThisIsAnInvalidAuthorizationToken'
    },
    body: JSON.stringify(newProvider)
  };

  return testEndpoint(providerEndpoint, request, async (response) => {
    assertions.isInvalidAuthorizationResponse(t, response);
    await providerDoesNotExist(t, newProvider.id);
  });
});

test('POST creates a new provider', (t) => {
  const newProviderId = 'AQUA';
  const newProvider = Object.assign({}, t.context.testProvider, { id: newProviderId });

  const postEvent = {
    httpMethod: 'POST',
    body: JSON.stringify(newProvider),
    headers: authHeaders
  };

  return testEndpoint(providerEndpoint, postEvent, (response) => {
    const { message, record } = JSON.parse(response.body);
    t.is(message, 'Record saved');
    t.is(record.id, newProviderId);
  });
});