'use strict'

const users = require('./users')

function welcome(name) {
  return users.greet(name) + '!'
}

module.exports = { welcome }
