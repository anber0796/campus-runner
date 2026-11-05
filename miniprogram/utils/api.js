/**
 * 数据访问层 —— 页面只调这里，不直接碰 wx.cloud 或假数据。
 * 切换 USE_MOCK 即可在「本地假数据」和「云函数」之间切换，页面代码零改动。
 */
const config = require('./config')
const mock = require('./mock')

function call(action, data) {
  const payload = data || {}

  if (config.USE_MOCK) {
    return mock.handle(action, payload)
  }

  return wx.cloud
    .callFunction({ name: 'api', data: Object.assign({ action: action }, payload) })
    .then(function (res) {
      const r = res.result || {}
      if (r.code !== 0) {
        const err = new Error(r.msg || '请求失败')
        err.code = r.code
        throw err
      }
      return r.data
    })
}

module.exports = {
  call: call,

  // —— 学生 ——
  getStudent: function () {
    return call('student.get')
  },
  saveStudent: function (profile, partial) {
    return call('student.save', { profile: profile, partial: !!partial })
  },

  // —— 顺路包 ——
  listPacks: function () {
    return call('packs.list')
  },
  getPack: function (id) {
    return call('packs.detail', { id: id })
  },
  acceptPack: function (id) {
    return call('packs.accept', { id: id })
  },

  // —— 履约 ——
  myOrders: function () {
    return call('orders.my')
  },
  pickupOrder: function (packId, orderId) {
    return call('deliver.pickup', { packId: packId, orderId: orderId })
  },
  deliverPack: function (packId, photo) {
    return call('deliver.complete', { packId: packId, photo: photo })
  },

  // —— 钱包 ——
  getWallet: function () {
    return call('wallet.summary')
  },
}
