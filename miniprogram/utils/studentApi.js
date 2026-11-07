/**
 * 学生档案读写 —— 只做两件事：读我的档案、保存档案
 *
 * 为什么单独一个文件：云端 `api` 函数只保留了 student.* 两个接口，
 * 其余（顺路包那套）已随旧模型下线。骑手端其它接口都在 `packer` 里，
 * 所以这里显式指定函数名，避免以后有人误以为走的也是 packer。
 */
const config = require('./config')
const mockRunner = require('./mockRunner')
const net = require('./net')

function call(action, data) {
  if (config.USE_MOCK) {
    return mockRunner.handle(action, data || {})
  }

  return wx.cloud
    .callFunction({
      name: 'api',
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
    .catch(function (err) {
      if (err && typeof err.code === 'number') throw err
      const f = net.friendly(err)
      const e = new Error(f.message)
      e.code = f.retryable ? 'NETWORK' : 'UNKNOWN'
      throw e
    })
}

module.exports = {
  get: function () {
    return call('student.get')
  },

  save: function (profile, partial) {
    return call('student.save', { profile: profile, partial: !!partial })
  },
}
