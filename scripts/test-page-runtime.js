/**
 * 页面运行时冒烟 —— 在 Node 里把页面真的初始化一遍
 *
 *   node scripts/test-page-runtime.js
 *
 * 静态检查只能发现"函数没定义"这类字面错误；这个脚本会把页面跑起来，
 * 走 onLoad / onShow，看数据能不能真的填进去——像刚才 applyOpen 那样的
 * 运行期 ReferenceError，会在这里直接暴露成"页面初始化失败"。
 *
 * 环境是真的：页面 require 的 riderApi / mockRunner 都是项目里的同一份代码，
 * 只有 wx.* 是桩。
 */
const path = require('path')

const MP = path.join(__dirname, '..', 'miniprogram')

let passed = 0
const failures = []

// 先留住真实计时器，再把全局的换成桩（否则 wait 会永远不 resolve）
const realSetTimeout = global.setTimeout
const realSetInterval = global.setInterval

// ---------- wx 桩 ----------
const storage = {}
global.wx = {
  getStorageSync: function (k) { return storage[k] },
  setStorageSync: function (k, v) { storage[k] = v },
  removeStorageSync: function (k) { delete storage[k] },
  showToast: function () {},
  showModal: function (o) { if (o && o.success) o.success({ confirm: false }) },
  navigateTo: function () {},
  redirectTo: function () {},
  switchTab: function () {},
  navigateBack: function () {},
  stopPullDownRefresh: function () {},
  pageScrollTo: function () {},
  setClipboardData: function (o) { if (o && o.success) o.success() },
  scanCode: function () {},
  chooseMedia: function () {},
  cloud: { callFunction: function () { return Promise.reject(new Error('no cloud')) } },
}
global.setInterval = function () { return 0 }
global.clearInterval = function () {}
// 注意：不能桩 setTimeout —— mockRunner 的 delay() 用它来 resolve

// ---------- 页面装载器 ----------
function loadPage(rel, query) {
  let captured = null
  global.Page = function (opts) { captured = opts }

  // 每次装载前清掉缓存，保证是全新实例
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf(MP) >= 0 && k.indexOf('utils') >= 0) delete require.cache[k]
  })

  require(path.join(MP, rel))

  if (!captured) throw new Error(rel + ' 没有调用 Page()')

  const inst = Object.assign({}, captured)
  inst.data = JSON.parse(JSON.stringify(captured.data || {}))
  inst.setData = function (patch) {
    Object.keys(patch || {}).forEach(function (k) {
      // 只处理普通键，路径型的（a[0].b）跳过
      if (k.indexOf('[') < 0 && k.indexOf('.') < 0) inst.data[k] = patch[k]
    })
  }

  if (inst.onLoad) inst.onLoad(query || {})
  if (inst.onShow) inst.onShow()

  return inst
}

function wait(ms) {
  return new Promise(function (r) { realSetTimeout(r, ms) })
}

// ---------- 用例 ----------
async function check(name, rel, query, assertFn) {
  try {
    const inst = loadPage(rel, query)
    await wait(120)
    assertFn(inst.data)
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + (e && e.message))
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

async function main() {
  await check('我的任务：三个页签都有数据', 'pages/tasks/tasks', {}, function (d) {
    assert(d.pool.length > 0, '可抢单为空')
    assert(d.poolGroups.length > 0, '食堂分组为空')
    assert(d.pick.length > 0, '待取餐为空')
    assert(d.deliverGroups.length > 0, '待送达为空')
    assert(!d.error, '出现错误: ' + d.error)
  })

  await check('取餐页：能按食堂加载出楼层分组', 'pages/pickup/pickup', {}, function (d) {
    assert(d.orderCount > 0, '订单数为 0')
    assert(d.groups.length > 0, '楼层分组为空')
    assert(d.groups[0].stalls.length > 0, '商家分组为空')
    assert(!d.error, '出现错误: ' + d.error)
  })

  await check('送达页：能按楼栋分组', 'pages/delivery/delivery', {}, function (d) {
    assert(d.groups.length > 0, '楼栋分组为空')
    assert(d.groups[0].floors.length > 0, '楼层为空')
    assert(!d.error, '出现错误: ' + d.error)
  })

  await check('钱包：可提现与流水可读', 'pages/wallet/wallet', {}, function (d) {
    assert(typeof d.available === 'string', '可提现没算出来')
    assert(d.logs.length > 0, '流水为空')
    assert(!d.error, '出现错误: ' + d.error)
  })

  await check('我的：档案能读出来', 'pages/me/me', {}, function (d) {
    assert(d.student && d.student.name, '学生档案为空')
    assert(!d.error, '出现错误: ' + d.error)
  })

  await check('邀请：邀请码与进度可读', 'pages/invite/invite', {}, function (d) {
    assert(d.code && d.code.length === 6, '邀请码为空')
    assert(typeof d.registered === 'number', '进度为空')
    assert(!d.error, '出现错误: ' + d.error)
  })

  console.log('\n通过 ' + passed + ' 项')
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项')
    process.exit(1)
  }
}

main().catch(function (e) {
  console.error('崩溃:', e)
  process.exit(1)
})
