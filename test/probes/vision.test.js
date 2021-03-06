'use strict'

const semver = require('semver')
const pkg = require('vision/package.json')

// this test is split into two separate files so that one can use async/await syntax.
// the javascript parser will flag syntax errors if it encounters async/await prior to
// versions that support it.

if (semver.gte(pkg.version, '5.0.0')) {
  require('./vision/vision-5-and-above')
} else {
  require('./vision/vision-4-and-below')
}
