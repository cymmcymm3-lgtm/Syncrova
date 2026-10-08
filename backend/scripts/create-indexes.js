#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const {
  getConfiguredMongoDatabaseName,
  withConfiguredMongoDatabaseName
} = require('../utils/mongo');

const dryRun = process.argv.slice(2).includes('--dry-run');

const loadModels = () => {
  const modelsDirectory = path.resolve(__dirname, '..', 'models');
  fs.readdirSync(modelsDirectory)
    .filter(file => file.endsWith('.js'))
    .sort()
    .forEach(file => require(path.join(modelsDirectory, file)));

  return mongoose.modelNames()
    .sort()
    .map(modelName => mongoose.model(modelName));
};

const requireMongoTarget = () => {
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) {
    throw new Error('MONGODB_URI is required. Refusing to fall back to a local database.');
  }

  if (!getConfiguredMongoDatabaseName(uri)) {
    throw new Error('Set MONGODB_DB_NAME or include a database name in MONGODB_URI.');
  }

  return uri;
};

const isExistingIndexOptionConflict = (err) => {
  const message = String(err?.message || '');
  return [85, 86].includes(err?.code)
    && (
      /equivalent index already exists with the same name but different options/i.test(message)
      || /existing index has the same name as the requested index/i.test(message)
    );
};

const ensureModelIndexes = async (model) => {
  const declaredIndexes = model.schema.indexes();
  let optionConflicts = 0;

  for (const [fields, options] of declaredIndexes) {
    try {
      await model.collection.createIndex(fields, options);
    } catch (err) {
      if (!isExistingIndexOptionConflict(err)) throw err;

      optionConflicts += 1;
      console.warn(`${model.modelName}: left an existing index unchanged because its options differ from the schema declaration (${JSON.stringify(fields)}).`);
    }
  }

  console.log(`${model.modelName}: ${declaredIndexes.length - optionConflicts} declared index(es) ensured${optionConflicts ? `; ${optionConflicts} existing option conflict(s) left unchanged` : ''}`);
};

const main = async () => {
  const models = loadModels();

  if (dryRun) {
    console.log(`Dry run: ${models.length} models have the following declared indexes:`);
    models.forEach(model => {
      const indexes = model.schema.indexes().map(([fields]) => JSON.stringify(fields));
      console.log(`${model.modelName}: ${indexes.length ? indexes.join(', ') : 'none'}`);
    });
    return;
  }

  const mongoUri = requireMongoTarget();

  await mongoose.connect(mongoUri, withConfiguredMongoDatabaseName(mongoUri, {
    autoIndex: false,
    maxPoolSize: 2,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000
  }));

  console.log(`Creating declared indexes for ${models.length} models in ${mongoose.connection.name}.`);
  console.log('This command only creates missing indexes; it does not drop or synchronize existing indexes. Existing option conflicts are reported and left unchanged.');

  for (const model of models) {
    await ensureModelIndexes(model);
  }

  console.log('Declared indexes are ready.');
};

main()
  .catch(err => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
