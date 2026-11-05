/**
 * 错误翻译测试
 *
 *   node scripts/test-net.js
 *
 * 这段逻辑不复杂，但决定学生看到的是"网络不太稳"还是
 * "cloud.callFunction:fail errCode: -501000"——后者等于劝退。
 */
const assert = require('assert')
const net = require('../miniprogram/utils/net')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

test('超时 → 识别为网络问题，可重试', function () {
  const r = net.friendly({ errMsg: 'request:fail timeout' })
  assert.strictEqual(r.retryable, true)
  assert.ok(r.message.indexOf('网络') >= 0, r.message)
  assert.ok(r.message.indexOf('timeout') < 0, '不该把英文报错抛给用户')
})

test('云函数调用失败 → 识别为网络问题', function () {
  const r = net.friendly({ errMsg: 'cloud.callFunction:fail errCode: -501000' })
  assert.strictEqual(r.retryable, true)
  assert.ok(r.message.indexOf('网络') >= 0)
})

test('401 → 提示重新登录，不给重试按钮', function () {
  const r = net.friendly({ code: 401, message: '登录已失效' })
  assert.strictEqual(r.retryable, false)
  assert.ok(r.message.indexOf('登录') >= 0)
})

test('403 → 保留业务原因，不提示重试', function () {
  const r = net.friendly({ code: 403, message: '认证通过后才能接单' })
  assert.strictEqual(r.retryable, false)
  assert.strictEqual(r.message, '认证通过后才能接单')
})

test('409（被别人抢走）→ 原样透出业务提示', function () {
  const r = net.friendly({ code: 409, message: '手慢了，这批已被抢走' })
  assert.strictEqual(r.message, '手慢了，这批已被抢走')
})

test('未知异常 → 给一句兜底人话', function () {
  const r = net.friendly({ message: '' })
  assert.ok(r.message.length > 0)
  assert.strictEqual(r.retryable, true)
})

test('null 不崩', function () {
  const r = net.friendly(null)
  assert.ok(r.message.length > 0)
})

test('isNetworkError 对业务错误返回 false', function () {
  assert.strictEqual(net.isNetworkError({ code: 409, message: '手慢了' }), false)
})

test('isNetworkError 对超时返回 true', function () {
  assert.strictEqual(net.isNetworkError({ errMsg: 'request:fail timeout' }), true)
})

console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
