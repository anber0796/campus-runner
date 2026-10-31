/**
 * 冒烟测试 —— 不开微信开发者工具，直接在 Node 里跑完整业务链路。
 * 验证的是「假数据层 + 佣金 + 状态流转」是否自洽，和云函数用的是同一套规则。
 *
 *   node scripts/smoke.js
 */
const mock = require('../miniprogram/utils/mock')

const ok = []
const bad = []

function check(name, cond, extra) {
  if (cond) {
    ok.push(name)
  } else {
    bad.push(name + (extra ? '  → ' + extra : ''))
  }
}

async function main() {
  // 1. 未认证学生
  const s1 = await mock.handle('student.get', {})
  check('未认证时提示缺 3 项', s1.missing.length === 3, JSON.stringify(s1.missing))

  // 2. 顺路包列表：收益 < 2.0 的包必须被过滤掉
  const list = await mock.handle('packs.list', {})
  check('列表返回 2 个包（第 3 个因收益不足被过滤）', list.packs.length === 2, '实际 ' + list.packs.length)
  list.packs.forEach(function (p) {
    check('包 ' + p.id.slice(-2) + ' 收益 ≥ 2.0', p.income.total >= 2.0, String(p.income.total))
  })

  // 3. 接单
  const target = list.packs[0]
  const accepted = await mock.handle('packs.accept', { id: target.id })
  check('接单后状态为 accepted', accepted.status === 'accepted', accepted.status)
  // 契约：写操作必须返回"包对象本身"，不能包成 { pack }
  // 否则页面上的 pack.income 会是 undefined —— 这个坑真踩过
  check('accept 返回包对象本身（含 income）', !!(accepted && accepted.income && accepted.income.detail),
    '实际拿到: ' + JSON.stringify(Object.keys(accepted || {})))

  // 4. 同一个包不能被接第二次
  let dupBlocked = false
  try {
    await mock.handle('packs.accept', { id: target.id })
  } catch (e) {
    dupBlocked = true
  }
  check('重复接单被拒绝', dupBlocked)

  // 5. 未取齐不能送达
  let blockDeliver = false
  try {
    await mock.handle('deliver.complete', { packId: target.id, photo: 'x.jpg' })
  } catch (e) {
    blockDeliver = true
  }
  check('没取齐餐时拒绝送达', blockDeliver)

  // 6. 逐单核销
  let picked = null
  for (const o of target.orders) {
    picked = await mock.handle('deliver.pickup', { packId: target.id, orderId: o.id })
  }
  check('pickup 返回包对象本身（含 income）', !!(picked && picked.income),
    '实际拿到: ' + JSON.stringify(Object.keys(picked || {})))
  const afterPick = await mock.handle('packs.detail', { id: target.id })
  check('取齐后 pickedCount 等于单量', afterPick.pickedCount === target.orders.length,
    afterPick.pickedCount + '/' + target.orders.length)

  // 7. 送达并产生结算流水
  const completed = await mock.handle('deliver.complete', { packId: target.id, photo: 'proof.jpg' })
  check('complete 返回包对象本身（含 income）', !!(completed && completed.income),
    '实际拿到: ' + JSON.stringify(Object.keys(completed || {})))
  const detail = await mock.handle('packs.detail', { id: target.id })
  check('送达后状态为 delivered', detail.status === 'delivered', detail.status)

  const wallet = await mock.handle('wallet.summary', {})
  check('钱包产生待结算金额', wallet.pending > 0, String(wallet.pending))
  check('流水金额与包收益一致', Math.abs(wallet.pending - detail.income.total) < 0.001,
    wallet.pending + ' vs ' + detail.income.total)

  // 8. 我的单
  const mine = await mock.handle('orders.my', {})
  check('我的单里有 1 个已完成', mine.finished.length === 1, String(mine.finished.length))

  // 9. 阶梯计价校验：3 单的包，第一单应比后面贵
  const p = list.packs[0]
  const fees = p.income.detail.map(function (d) { return d.fee })
  check('阶梯计价生效（首单 > 次单）', fees[0] > fees[1], fees.join(' / '))

  console.log('\n通过 ' + ok.length + ' 项')
  ok.forEach(function (n) { console.log('  ✓ ' + n) })
  if (bad.length) {
    console.log('\n失败 ' + bad.length + ' 项')
    bad.forEach(function (n) { console.log('  ✗ ' + n) })
    process.exit(1)
  }
  console.log('\n全部通过')
}

main().catch(function (e) {
  console.error('崩溃:', e)
  process.exit(1)
})
