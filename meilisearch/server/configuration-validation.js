const { isObject } = require('../utils')

/**
 * Validates the plugin configuration provided in `plugins/config.js` of the users plugin configuration.
 * Modifies the value of config on place.
 *
 * @param  {object} config - configurations
 */
function validateConfiguration(config) {
  const validPluginField = ['host', 'apiKey']

  if (!config) {
    return
  }

  if (!isObject(config)) {
    strapi.log.error(
      'The `config` field in the MeiliSearch  plugin configuration must be of type object'
    )
    config = {}
  }

  // Validate the attributes
  Object.keys(config).forEach(attribute => {
    if (!validPluginField.includes(attribute)) {
      strapi.log.warn(
        `The field "${attribute}" in the MeiliSearch plugin config is not a valid parameter`
      )
      delete config[attribute]
    }
  })

  // Validate the `host` parameter
  if (config.host && typeof config.host !== 'string') {
    strapi.log.error(
      '`host` should be a none empty string in MeiliSearch configuration'
    )
    delete config.host
  }

  // Validate the `apikey` parameter
  if (config.apiKey && typeof config.apiKey !== 'string') {
    strapi.log.error(
      '`apiKey` should be a none empty string in MeiliSearch configuration'
    )
    delete config.apiKey
  }
}

function validateContentTypeConfigs({ strapi }) {
  const apis = strapi.plugin('meilisearch').service('contentTypes').getApis()
  console.log(apis)
  for (const api of apis) {
    validateContentTypeConfig(api)
  }
}

function validateContentTypeConfig(api) {
  const validApiFields = ['indexName', 'transformEntry', 'settings']
  const apiName = api.split('.')[1]

  console.log(api)
  const configuration = strapi.service(api).meilisearch

  if (!configuration) {
    return
  }

  if (configuration && !isObject(configuration)) {
    strapi.log.error(
      `The "meilisearch" configuration in the ${apiName} service should be of type object`
    )
    strapi.service('api::restaurant.restaurant').meilisearch = {}
  }
  if (
    (configuration.indexName && typeof configuration.indexName !== 'string') ||
    configuration.indexName === ''
  ) {
    strapi.log.error(
      `the "indexName" param in the "${apiName}" service should be a none empty string`
    )
    delete configuration.indexName
  }
  if (
    configuration.transformEntry &&
    typeof configuration.transformEntry !== 'function'
  ) {
    strapi.log.error(
      `the "transformEntry" param in the "${apiName}" service should be should be a function`
    )
    delete configuration.transformEntry
  }

  if (configuration.settings && !isObject(configuration.settings)) {
    strapi.log.error(
      `the "transformEntry" param in the "${apiName}" service should be should be a function`
    )
    strapi.log.error(
      `the "settings" param in the "${apiName}" service should be should be an object`
    )
    delete configuration.settings
  }

  Object.keys(configuration).forEach(attribute => {
    if (!validApiFields.includes(attribute)) {
      strapi.log.warn(
        `${attribute} in "${apiName}" in the MeiliSearch plugin config is not a valid parameter`
      )
      delete configuration[attribute]
    }
  })
  return configuration
}

module.exports = {
  validateConfiguration,
  validateContentTypeConfigs,
  validateContentTypeConfig,
}
