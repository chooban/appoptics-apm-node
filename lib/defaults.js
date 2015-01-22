module.exports = {
  redis: {
    enabled: true,
    collectBacktraces: true
  },
  mongodb: {
    enabled: true,
    collectBacktraces: true
  },
  'http-client': {
    enabled: true,
    collectBacktraces: true
  },
  'https-client': {
    enabled: true,
    collectBacktraces: true
  },
  mysql: {
    enabled: true,
    collectBacktraces: true
  },
  pg: {
    enabled: true,
    collectBacktraces: true
  },
  'node-cassandra-cql': {
    enabled: true,
    collectBacktraces: true
  },
  'cassandra-driver': {
    enabled: true,
    collectBacktraces: true
  },
  memcached: {
    enabled: true,
    collectBacktraces: true
  },
  levelup: {
    enabled: true,
    collectBacktraces: true,
    enableBatchTracing: false
  },
  hapi: {
    enabled: true,
    collectBacktraces: true
  },
  restify: {
    enabled: true,
    collectBacktraces: true
  },
  tedious: {
    enabled: true,
    collectBacktraces: true
  }
}