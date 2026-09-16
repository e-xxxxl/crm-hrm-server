/**
 * Register a schema on a specific connection, reusing an existing compiled model
 * if one is already present. This keeps `node --watch` reloads from throwing
 * "Cannot overwrite model once compiled".
 */
export function registerModel(connection, name, schema) {
  return connection.models[name] || connection.model(name, schema);
}

export default registerModel;
