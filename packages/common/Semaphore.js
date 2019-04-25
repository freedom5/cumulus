const { ResourcesLockedError } = require('./errors');
const log = require('./log');

class Semaphore {
  constructor(docClient, tableName) {
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async create(key, max) {
    try {
      const params = {
        TableName: this.tableName,
        Item: {
          key,
          semvalue: 0,
          max
        },
        ConditionExpression: '#key <> :key',
        ExpressionAttributeNames: { '#key': 'key' },
        ExpressionAttributeValues: { ':key': key }
      };
      await this.docClient.put(params).promise();
    } catch (e) {
      // Only re-throw errors that are not conditional check failures. A
      // conditional check failure here means that a row tracking the semaphore
      // for this key already exists, which is expected after the first operation.
      if (e.code !== 'ConditionalCheckFailedException') {
        throw e;
      }
    }
  }

  up(key, maximum) {
    return this.add(key, 1, maximum);
  }

  down(key, maximum) {
    return this.add(key, -1, maximum);
  }

  async checkout(key, count, max, fn) {
    let result = null;
    log.info(`Incrementing ${key} by ${count}`);
    try {
      await this.add(key, count, max);
    } catch (e) {
      if (e.message === 'The conditional request failed') {
        throw new ResourcesLockedError(`Could not increment ${key} by ${count}`);
      }
      log.error(e.message, e.stack);
      throw e;
    }
    try {
      result = await fn();
    } finally {
      log.info(`Decrementing ${key} by ${count}`);
      await this.add(key, -count);
    }
    return result;
  }

  async add(key, count, max) {
    // Create the semaphore if it doesn't exist.
    await this.create(key, max);

    const updateParams = {
      TableName: this.tableName,
      Key: {
        key
      },
      UpdateExpression: 'set #semvalue = #semvalue + :val',
      ExpressionAttributeNames: {
        '#semvalue': 'semvalue'
      },
      ExpressionAttributeValues: {
        ':val': count
      },
      ReturnValues: 'UPDATED_NEW'
    };

    if (count > 0 && max >= 0) {
      // Determine the effective maximum for this operation and prevent
      // semaphore value from exceeding overall maximum.
      //
      // If we are incrementing the semaphore by 1 and the maximum is 1,
      // then the effective maximum for this operation is that the semaphore
      // value should not already exceed 0 (1 - 1 = 0). If it does already
      // exceed 0, then incrementing the semaphore by one would exceed the
      // maximum (1 + 1 > 1);
      updateParams.ExpressionAttributeValues[':max'] = max - count;
      updateParams.ConditionExpression = '#semvalue <= :max';
    }

    return this.docClient.update(updateParams).promise();
  }
}

module.exports = Semaphore;
