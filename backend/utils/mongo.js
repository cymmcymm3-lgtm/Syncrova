const clean = (value = '') => String(value || '').trim();

const getDatabaseNameFromUri = (uri = '') => {
  const match = String(uri).match(/^mongodb(?:\+srv)?:\/\/(?:[^@/?#]+@)?[^/?#]+(?:\/([^?#]*))?/i);
  return decodeURIComponent(match?.[1] || '').trim();
};

const getConfiguredMongoDatabaseName = (uri = '') => (
  clean(process.env.MONGODB_DB_NAME) || getDatabaseNameFromUri(uri)
);

const withConfiguredMongoDatabaseName = (uri, options = {}) => {
  const dbName = getConfiguredMongoDatabaseName(uri);
  return dbName ? { ...options, dbName } : options;
};

module.exports = {
  getConfiguredMongoDatabaseName,
  getDatabaseNameFromUri,
  withConfiguredMongoDatabaseName
};
