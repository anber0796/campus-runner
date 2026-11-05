/**
 * 运营后台接口封装（走云函数 packer 的 admin.* 路由）
 *
 * 和 utils/api.js 的区别：
 *   api.js    学生端，身份靠 wx.cloud 的 OPENID 自动识别
 *   adminApi  运营端，身份靠登录后拿到的 token，显式带上
 */
const config = require('./config')

const TOKEN_KEY = 'admin_token'
const NAME_KEY = 'admin_name'

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || ''
}

function setSession(data) {
  wx.setStorageSync(TOKEN_KEY, data.token)
  wx.setStorageSync(NAME_KEY, data.username)
}

function getUsername() {
  return wx.getStorageSync(NAME_KEY) || ''
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY)
  wx.removeStorageSync(NAME_KEY)
}

function call(action, data) {
  if (config.USE_MOCK) {
    return Promise.reject(new Error('运营后台需要关闭 USE_MOCK 并部署云函数'))
  }

  return wx.cloud
    .callFunction({
      name: 'packer',
      data: Object.assign({ action: action, token: getToken() }, data || {}),
    })
    .then(function (res) {
      const r = res.result || {}
      if (r.code === 401) {
        clearSession()
        const err = new Error(r.msg || '请重新登录')
        err.code = 401
        throw err
      }
      if (r.code !== 0) {
        const err = new Error(r.msg || '请求失败')
        err.code = r.code
        throw err
      }
      return r.data
    })
}

module.exports = {
  getToken: getToken,
  getUsername: getUsername,
  setSession: setSession,
  clearSession: clearSession,
  call: call,

  login: function (username, password) {
    return call('admin.login', { username: username, password: password })
      .then(function (d) {
        setSession(d)
        return d
      })
  },

  bootstrap: function (username, password) {
    return call('admin.bootstrap', { username: username, password: password })
      .then(function (d) {
        setSession(d)
        return d
      })
  },

  stats: function () {
    return call('admin.stats')
  },

  execute: function () {
    return call('admin.execute')
  },

  republish: function (packId) {
    return call('admin.republish', { packId: packId })
  },

  pendingBatches: function () {
    return call('admin.pendingBatches')
  },

  publishBatch: function (batchId, price) {
    return call('admin.publishBatch', { batchId: batchId, price: price })
  },

  publishAll: function () {
    return call('admin.publishAll')
  },
}
