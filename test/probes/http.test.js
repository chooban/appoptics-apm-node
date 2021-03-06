'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')

const addon = ao.addon

const request = require('request')
const http = require('http')

describe('probes.http', function () {
  const ctx = {http: http}
  let emitter
  let realSampleTrace

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = addon.MAX_SAMPLE_RATE
    ao.sampleMode = 'always'
    realSampleTrace = ao.addon.Context.sampleTrace
    ao.addon.Context.sampleTrace = function () {
      return {sample: true, source: 6, rate: ao.sampleRate}
    }
    ao.g.testing(__filename)
  })
  after(function (done) {
    ao.addon.Context.sampleTrace = realSampleTrace
    emitter.close(done)
  })

  const check = {
    server: {
      entry: function (msg) {
        msg.should.have.property('Layer', 'nodejs')
        msg.should.have.property('Label', 'entry')
      },
      info: function (msg) {
        msg.should.have.property('Label', 'info')
      },
      error: function (msg) {
        msg.should.have.property('Label', 'error')
      },
      exit: function (msg) {
        msg.should.have.property('Layer', 'nodejs')
        msg.should.have.property('Label', 'exit')
      }
    },
    client: {
      entry: function (msg) {
        msg.should.have.property('Layer', 'http-client')
        msg.should.have.property('Label', 'entry')
      },
      info: function (msg) {
        msg.should.have.property('Label', 'info')
      },
      error: function (msg) {
        msg.should.have.property('Label', 'error')
      },
      exit: function (msg) {
        msg.should.have.property('Layer', 'http-client')
        msg.should.have.property('Label', 'exit')
      }
    }
  }

  describe('http-server', function () {
    const conf = ao.probes.http

    // it's possible for a local UDP send to fail but oboe doesn't report
    // it, so compensate for it.
    it('UDP might lose a message running locally', function (done) {
      helper.test(emitter, function (done) {
        ao.instrument('fake', function () { })
        done()
      }, [
        function (msg) {
          msg.should.have.property('Label').oneOf('entry', 'exit'),
          msg.should.have.property('Layer', 'fake')
        }
      ], done)
    })

    //
    // Test a simple res.end() call in an http server
    //
    it('should send traces for http routing and response spans', function (done) {
      let port
      const server = http.createServer(function (req, res) {
        res.end('done')
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
          msg.should.have.property('Method', 'GET')
          msg.should.have.property('Proto', 'http')
          msg.should.have.property('HTTP-Host', 'localhost')
          msg.should.have.property('Port', port)
          msg.should.have.property('URL', '/foo?bar=baz')
          msg.should.have.property('ClientIP')
        },
        function (msg) {
          check.server.exit(msg)
          msg.should.have.property('Status', 200)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        port = server.address().port
        request('http://localhost:' + port + '/foo?bar=baz')
      })
    })

    //
    // Verify X-Trace header results in a continued trace
    //
    it('should continue tracing when receiving an xtrace id header', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
      })

      const origin = new ao.Event('span-name', 'label-name', '')

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
          msg.should.have.property('Edge', origin.opId)
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        const port = server.address().port
        request({
          url: 'http://localhost:' + port,
          headers: {
            'X-Trace': origin.toString()
          }
        })
      })
    })

    //
    // Verify that a bad X-Trace header does not result in a continued trace
    //
    it('should not continue tracing when receiving a bad xtrace id header', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
      })

      const origin = new ao.Event('span-name', 'label-name', '')
      const xtrace = origin.toString().slice(0, 42) + '0'.repeat(16) + '01'

      const logChecks = [
        {level: 'warn', message: `invalid X-Trace header received ${xtrace}`},
      ]
      helper.checkLogMessages(ao.debug, logChecks)

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
          msg.should.not.have.property('Edge', origin.opId)
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        const port = server.address().port
        request({
          url: 'http://localhost:' + port,
          headers: {
            'X-Trace': xtrace
          }
        })
      })
    })

    //
    // Verify always trace mode forwards sampling data
    //
    it('should forward sampling data in always trace mode', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
          msg.should.have.property('SampleSource')
          msg.should.have.property('SampleRate')
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        const port = server.address().port
        request({
          url: 'http://localhost:' + port
        })
      })
    })

    //
    // Verify behaviour of asyncrony within a request
    //
    it('should trace correctly within asyncrony', function (done) {
      const server = http.createServer(function (req, res) {
        setTimeout(function () {
          res.end('done')
        }, 10)
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        const port = server.address().port
        request('http://localhost:' + port)
      })
    })

    //
    // Verify query param filtering support
    //
    it('should support query param filtering', function (done) {
      conf.includeRemoteUrlParams = false
      const server = http.createServer(function (req, res) {
        res.end('done')
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
          msg.should.have.property('URL', '/foo')
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function (err) {
        conf.includeRemoteUrlParams = true
        server.close(done.bind(null, err))
      })

      server.listen(function () {
        const port = server.address().port
        request('http://localhost:' + port + '/foo?bar=baz')
      })
    })

    //
    // Validate the various headers that get passed through to the event
    //
    const passthroughHeaders = {
      'X-Forwarded-For': 'Forwarded-For',
      'X-Forwarded-Host': 'Forwarded-Host',
      'X-Forwarded-Port': 'Forwarded-Port',
      'X-Forwarded-Proto': 'Forwarded-Proto',
      'X-Request-Start': 'Request-Start',
      'X-Queue-Start': 'Request-Start',
      'X-Queue-Time': 'Queue-Time'
    }

    Object.keys(passthroughHeaders).forEach(function (key) {
      const val = passthroughHeaders[key]

      const headers = {}
      headers[key] = 'test'

      it('should map ' + key + ' header to event.' + val, function (done) {
        const server = http.createServer(function (req, res) {
          res.end('done')
        })

        helper.doChecks(emitter, [
          function (msg) {
            check.server.entry(msg)
            msg.should.have.property(val, 'test')
          },
          function (msg) {
            check.server.exit(msg)
          }
        ], function () {
          server.close(done)
        })

        server.listen(function () {
          const port = server.address().port
          const options = {
            url: 'http://localhost:' + port,
            headers: headers
          }
          request(options)
        })
      })
    })

    //
    // Test errors emitted on http request object
    //
    it('should report request errors', function (done) {
      const error = new Error('test')
      let port
      const server = http.createServer(function (req, res) {
        req.on('error', noop)
        req.emit('error', error)
        res.end('done')
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
        },
        function (msg) {
          check.server.error(msg)
          msg.should.have.property('ErrorClass', 'Error')
          msg.should.have.property('ErrorMsg', error.message)
          msg.should.have.property('Backtrace', error.stack)
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        port = server.address().port
        request('http://localhost:' + port + '/foo?bar=baz')
      })
    })

    //
    // Test errors emitted on http response object
    //
    it('should report response errors', function (done) {
      const error = new Error('test')
      let port
      const server = http.createServer(function (req, res) {
        res.on('error', noop)
        res.emit('error', error)
        res.end('done')
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
        },
        function (msg) {
          check.server.error(msg)
          msg.should.have.property('ErrorClass', 'Error')
          msg.should.have.property('ErrorMsg', error.message)
          msg.should.have.property('Backtrace', error.stack)
        },
        function (msg) {
          check.server.exit(msg)
        }
      ], function () {
        server.close(done)
      })

      server.listen(function () {
        port = server.address().port
        request('http://localhost:' + port + '/foo?bar=baz')
      })
    })

    //
    // Validate that server.setTimeout(...) exits correctly
    //
    it('should exit when timed out', function (done) {
      const server = http.createServer(function (req, res) {
        setTimeout(function () {
          res.end('done')
        }, 20)
      })

      // Set timeout
      let reached = false
      server.setTimeout(10)
      server.on('timeout', function (res) {
        res._httpMessage.statusCode = 500
        reached = true
      })

      helper.doChecks(emitter, [
        function (msg) {
          check.server.entry(msg)
        },
        function (msg) {
          check.server.exit(msg)
          msg.should.have.property('Status', 500)
        }
      ], function () {
        reached.should.equal(true)
        server.close(done)
      })

      server.listen(function () {
        const port = server.address().port
        request('http://localhost:' + port)
      })
    })
  })

  //
  // http client tests
  //

  describe('http-client', function () {
    const conf = ao.probes['http-client']
    it('should trace http request', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
        server.close()
      })

      server.listen(function () {
        ctx.data = {port: server.address().port}
        const testFunction = helper.run(ctx, 'http/client')

        helper.test(emitter, testFunction, [
          function (msg) {
            check.client.entry(msg)
            msg.should.have.property('RemoteURL', ctx.data.url)
            msg.should.have.property('IsService', 'yes')
          },
          function (msg) {
            check.server.entry(msg)
          },
          function (msg) {
            check.server.exit(msg)
          },
          function (msg) {
            check.client.exit(msg)
            msg.should.have.property('HTTPStatus', 200)
          }
        ], done)
      })
    })

    it('should support object-based requests', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
        server.close()
      })

      server.listen(function () {
        const d = ctx.data = {port: server.address().port}
        const mod = helper.run(ctx, 'http/client-object')
        const url = 'http://' + d.hostname + ':' + d.port + d.path

        helper.test(emitter, mod, [
          function (msg) {
            check.client.entry(msg)
            msg.should.have.property('RemoteURL', url)
            msg.should.have.property('IsService', 'yes')
          },
          function (msg) {
            check.server.entry(msg)
          },
          function (msg) {
            check.server.exit(msg)
          },
          function (msg) {
            check.client.exit(msg)
            msg.should.have.property('HTTPStatus', 200)
          }
        ], done)
      })
    })

    it('should trace streaming http request', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
        server.close()
      })

      server.listen(function () {
        ctx.data = {port: server.address().port}
        const mod = helper.run(ctx, 'http/stream')

        helper.test(emitter, mod, [
          function (msg) {
            check.client.entry(msg)
            msg.should.have.property('RemoteURL', ctx.data.url)
            msg.should.have.property('IsService', 'yes')
          },
          function (msg) {
            check.server.entry(msg)
          },
          function (msg) {
            check.server.exit(msg)
          },
          function (msg) {
            check.client.exit(msg)
            msg.should.have.property('HTTPStatus', 200)
          }
        ], done)
      })
    })

    it('should support query filtering', function (done) {
      conf.includeRemoteUrlParams = false

      const server = http.createServer(function (req, res) {
        res.end('done')
        server.close()
      })

      server.listen(function () {
        ctx.data = {port: server.address().port}
        const mod = helper.run(ctx, 'http/query-filtering')

        helper.test(emitter, mod, [
          function (msg) {
            check.client.entry(msg)
            const url = ctx.data.url.replace(/\?.*/, '')
            msg.should.have.property('RemoteURL', url)
            msg.should.have.property('IsService', 'yes')
          },
          function (msg) {
            check.server.entry(msg)
          },
          function (msg) {
            check.server.exit(msg)
          },
          function (msg) {
            check.client.exit(msg)
            msg.should.have.property('HTTPStatus', 200)
            conf.includeRemoteUrlParams = true
          }
        ], done)
      })
    })

    it('should report request errors', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
        server.close()
      })

      server.listen(function () {
        const port = server.address().port
        const url = 'http://localhost:' + port + '/?foo=bar'
        const error = new Error('test')

        helper.test(emitter, function (done) {
          const req = http.get(url, function (res) {
            res.on('end', done)
            res.resume()
          })
          req.on('error', function () {})
          req.emit('error', error)
        }, [
          function (msg) {
            check.client.entry(msg)
            msg.should.have.property('RemoteURL', url)
            msg.should.have.property('IsService', 'yes')
          },
          function (msg) {
            check.client.error(msg)
            msg.should.have.property('ErrorClass', 'Error')
            msg.should.have.property('ErrorMsg', error.message)
            msg.should.have.property('Backtrace', error.stack)
          },
          function (msg) {
            check.server.entry(msg)
          },
          function (msg) {
            check.server.exit(msg)
          },
          function (msg) {
            check.client.exit(msg)
            msg.should.have.property('HTTPStatus', 200)
          }
        ], done)
      })
    })

    it('should report response errors', function (done) {
      const server = http.createServer(function (req, res) {
        res.end('done')
        server.close()
      })

      server.listen(function () {
        const port = server.address().port
        const url = 'http://localhost:' + port + '/?foo=bar'
        const error = new Error('test')

        helper.test(emitter, function (done) {
          http.get(url, function (res) {
            res.on('error', done.bind(null, null))
            res.emit('error', error)
          }).on('error', done)
        }, [
          function (msg) {
            check.client.entry(msg)
            msg.should.have.property('RemoteURL', url)
            msg.should.have.property('IsService', 'yes')
          },
          function (msg) {
            check.server.entry(msg)
          },
          function (msg) {
            check.server.exit(msg)
          },
          function (msg) {
            check.client.exit(msg)
            msg.should.have.property('HTTPStatus', 200)
          },
          function (msg) {
            check.server.error(msg)
            msg.should.have.property('ErrorClass', 'Error')
            msg.should.have.property('ErrorMsg', error.message)
            msg.should.have.property('Backtrace', error.stack)
          }
        ], done)
      })
    })
  })
})

function noop () {}
