/**
 * 骑手端接口封装（走 packer 云函数的 rider.* 路由）
 * 和 api.js 的区别：那套是旧的"顺路包"模型，这套是"抢单"模型。
 */
const config = require('./config')

function call(action, data) {
  if (config.USE_MOCK) {
    return Promise.reject(new Error('抢单大厅需要部署云函数（关闭 USE_MOCK）'))
  }

  return wx.cloud
    .callFunction({
      name: 'packer',
      data: Object.assign({ action: action }, data || {}),
    })
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
  home: function () { return call('rider.home') },
  grab: function (batchId) { return call('rider.grab', { batchId: batchId }) },
  myBatches: function () { return call('rider.myBatches') },
  pickup: function (batchId, orderNo) { return call('rider.pickup', { batchId: batchId, orderNo: orderNo }) },
  deliver: function (batchId, orderId, photo) {
    return call('rider.deliver', { batchId: batchId, orderId: orderId, photo: photo })
  },
  invite: function () { return call('rider.invite') },
  bindInvite: function (code) { return call('rider.bindInvite', { code: code }) },
}
