/**
 * 错误翻译 —— 把技术报错变成人能看懂的一句话
 *
 * 原始错误长这样：
 *   "cloud.callFunction:fail Error: errCode: -501000 ..."
 *   "request:fail timeout"
 * 学生看到这个只会一脸茫然，然后关掉小程序。
 *
 * 所以这里统一转成：一句人话 + 能不能重试。
 */
const NETWORK_HINTS = [
  'timeout',
  'request:fail',
  'network',
  'net::',
  'err_',
  'fail errcode',
  'cloud.callFunction:fail',
  '-501000',
  '-404011',
]

function rawMessage(err) {
  if (!err) return ''
  return String(err.errMsg || err.message || err || '')
}

/** 是不是"网络/服务连不上"这一类，值得提示重试 */
function isNetworkError(err) {
  const msg = rawMessage(err).toLowerCase()
  return NETWORK_HINTS.some(function (k) { return msg.indexOf(k.toLowerCase()) >= 0 })
}

/**
 * @returns {{message:string, retryable:boolean}}
 */
function friendly(err) {
  if (!err) return { message: '出错了，稍后再试', retryable: true }

  if (err.code === 401) return { message: '登录已失效，请重新登录', retryable: false }
  if (err.code === 403) return { message: err.message || '暂时没有权限', retryable: false }
  if (err.code === 'NETWORK') return { message: '网络不太稳，检查一下信号', retryable: true }

  if (isNetworkError(err)) {
    return { message: '网络不太稳，检查一下信号再试', retryable: true }
  }

  return { message: err.message || '出错了，稍后再试', retryable: true }
}

module.exports = {
  isNetworkError: isNetworkError,
  friendly: friendly,
}
