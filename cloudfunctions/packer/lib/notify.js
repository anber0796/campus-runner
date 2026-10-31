/**
 * 波次预告推送 —— PRD 6.3 第四步「下课预告唤醒」
 *
 * 这是整个产品最大的差异点：把学生的决策从"我现在有没有空"变成"我等下反正要经过"。
 * 波次前 8～10 分钟推一条，学生一键"我要带"。
 *
 * 但推送是双刃剑。PRD 原话：
 *   "单人每小时 ≤3 次、每天 ≤12 次。骚扰一次他就永久关通知，这是运力池最大的隐性损耗。"
 * 所以节流规则必须硬编码成不可绕过的闸，而不是靠调用方自觉。
 *
 * 另一个现实约束：微信的「一次性订阅消息」是**一次授权只能推一条**，
 * 没有长期订阅权限（餐饮/校园类目不开放）。所以策略不是"推得多"，
 * 而是"在正确时机反复要授权"——见 miniprogram/utils/subscribe.js。
 */

const RULES = {
  maxPerHour: 3,
  maxPerDay: 12,
  // 波次前多少分钟推
  leadMinutes: 10,
  // 收益低于这个数的包不值得占用一次推送额度
  minPackIncome: 2.0,
}

function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
}

/**
 * 这个学生现在还能不能收到推送
 * @param {Array} history 该学生的历史推送记录 [{ at }]
 * @param {Number} now
 * @returns {{ok:boolean, reason?:string, hourCount:number, dayCount:number}}
 */
function canNotify(history, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const nowTs = now || Date.now()
  const list = (history || []).filter(function (h) { return h && h.at <= nowTs })

  const hourCount = list.filter(function (h) { return nowTs - h.at < 3600 * 1000 }).length
  const dayCount = list.filter(function (h) { return sameDay(h.at, nowTs) }).length

  if (hourCount >= cfg.maxPerHour) {
    return { ok: false, reason: 'hourly_limit', hourCount: hourCount, dayCount: dayCount }
  }
  if (dayCount >= cfg.maxPerDay) {
    return { ok: false, reason: 'daily_limit', hourCount: hourCount, dayCount: dayCount }
  }
  return { ok: true, hourCount: hourCount, dayCount: dayCount }
}

/**
 * 这个包值不值得推
 * - 只能是待派的包
 * - 同一个包只预告一次（推过就不再叨扰）
 * - 收益低于下限不推：占用一次订阅额度却只值 ¥1.7，不划算
 */
function isEligiblePack(pack, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  if (!pack) return false
  if (pack.status !== 'available') return false
  if (pack.notifiedAt) return false
  const subtotal = pack.income && typeof pack.income.subtotal === 'number'
    ? pack.income.subtotal
    : (pack.income && typeof pack.income.total === 'number' ? pack.income.total : 0)
  return subtotal >= cfg.minPackIncome
}

/**
 * 学生能接哪些包：楼栋一致 + 食堂在其常去列表 + 波次在其勾选列表
 */
function matchPacks(student, packs) {
  const canteens = student.canteenIds || []
  const waves = student.waveIds || []
  return (packs || []).filter(function (p) {
    return p.buildingId === student.buildingId &&
      canteens.indexOf(p.canteenId) >= 0 &&
      waves.indexOf(p.waveId) >= 0
  })
}

/**
 * 组装订阅消息的 data。
 *
 * ⚠️ 这里的字段名（thing1 / amount2 / thing3 / time4）必须和小程序后台
 * 你选的那个模板一致，否则微信会返回 47003（参数不匹配）。
 * 换模板时改这一个函数即可。
 */
function buildTemplateData(pack, extra) {
  const e = extra || {}
  return {
    thing1: { value: (pack.canteenName || '食堂') + ' · ' + (pack.orderCount || 0) + ' 单' },
    amount2: { value: '¥' + ((pack.income && pack.income.total) || 0) },
    thing3: { value: (pack.buildingName || '') + ' ' + (pack.minFloor || '') + '-' + (pack.maxFloor || '') + ' 层' },
    time4: { value: e.waveTime || pack.waveLabel || '' },
  }
}

/** 一句话文案，用于日志与后台预览（订阅消息正文由模板决定，这里只做自查） */
function buildCaption(pack) {
  return '这一趟 ¥' + ((pack.income && pack.income.total) || 0) +
    ' · 顺路 ' + (pack.walkMinutes || 9) + ' 分钟 · 帮 ' + (pack.orderCount || 0) +
    ' 位同学带饭回 ' + (pack.buildingName || '')
}

module.exports = {
  RULES: RULES,
  canNotify: canNotify,
  isEligiblePack: isEligiblePack,
  matchPacks: matchPacks,
  buildTemplateData: buildTemplateData,
  buildCaption: buildCaption,
}
