/**
 * 邀请裂变 —— 你说的第 2 点
 *
 * 规则（按你给的）：
 *   推荐满 10 人注册          → 奖 20 元
 *   这 10 人完成首次跑单      → 再奖 30 元
 *
 * ⚠️ 合规红线：微信小程序明令禁止「诱导分享」。
 * 所以这套逻辑**只认业务结果**（注册成功、完成首单），
 * 从不检查"有没有分享"、也不在分享回调里发钱。
 * 小程序里只显示「我的邀请码」和进度，不弹"分享给好友得 20 元"。
 *
 * 防刷是重点：这个功能一旦被刷，是按 20/30 元往外送。
 */
const RULES = {
  teamSize: 10,          // 每满 10 人结算一次
  registerReward: 20,    // 满 10 人注册的奖励
  firstOrderReward: 30,  // 这 10 人完成首单的奖励

  codeLength: 6,
  // 邀请码字符集：去掉 0/O/1/I/L 这些肉眼分不清的，地推时少一半纠纷
  alphabet: '23456789ABCDEFGHJKMNPQRSTUVWXYZ',

  // 被邀请人必须在注册后这么多天内完成首单，才算数（防囤号）
  firstOrderWindowDays: 7,
  // 邀请人自己注册不足这么多天，不能拉人（挡住当天批量注册的号）
  minInviterAgeHours: 24,
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * 生成邀请码
 * @param {Function} random 便于测试注入的随机源，默认 Math.random
 */
function genCode(random) {
  const rnd = random || Math.random
  let out = ''
  for (let i = 0; i < RULES.codeLength; i++) {
    out += RULES.alphabet.charAt(Math.floor(rnd() * RULES.alphabet.length))
  }
  return out
}

/**
 * 算奖励
 * @param {Array} invitees [{ registeredAt, firstOrderAt }]
 * @returns {{amount:number, teams:Object, breakdown:Array}}
 */
function calcInviteReward(invitees, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const list = invitees || []

  const registered = list.length
  const firstOrdered = list.filter(function (i) {
    if (!i.firstOrderAt) return false
    if (!i.registeredAt) return true
    const days = (i.firstOrderAt - i.registeredAt) / 86400000
    return days <= cfg.firstOrderWindowDays
  }).length

  const regTeams = Math.floor(registered / cfg.teamSize)
  const orderTeams = Math.floor(firstOrdered / cfg.teamSize)

  const breakdown = []
  for (let i = 0; i < regTeams; i++) breakdown.push({ type: 'register_team', amount: cfg.registerReward })
  for (let i = 0; i < orderTeams; i++) breakdown.push({ type: 'first_order_team', amount: cfg.firstOrderReward })

  const amount = round2(
    regTeams * cfg.registerReward + orderTeams * cfg.firstOrderReward
  )

  return {
    amount: amount,
    registered: registered,
    firstOrdered: firstOrdered,
    teams: { register: regTeams, firstOrder: orderTeams },
    // 还差几个：给前端显示进度条
    nextRegisterGap: cfg.teamSize - (registered % cfg.teamSize),
    nextOrderGap: cfg.teamSize - (firstOrdered % cfg.teamSize),
    breakdown: breakdown,
  }
}

/**
 * 能不能建立这条邀请关系
 * @param {Object} inviter { openid, phone, deviceId, createdAt }
 * @param {Object} invitee { openid, phone, deviceId, invitedBy }
 * @param {Number} now
 */
function validateInvite(inviter, invitee, now, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const ts = now || Date.now()

  if (!inviter || !invitee) return { ok: false, reason: 'missing_user' }
  if (inviter.openid === invitee.openid) return { ok: false, reason: 'self_invite' }
  if (invitee.invitedBy) return { ok: false, reason: 'already_invited' }

  // 同一手机号：自邀的常见变体
  if (inviter.phone && invitee.phone && inviter.phone === invitee.phone) {
    return { ok: false, reason: 'same_phone' }
  }
  // 同一设备：一人多号刷量
  if (inviter.deviceId && invitee.deviceId && inviter.deviceId === invitee.deviceId) {
    return { ok: false, reason: 'same_device' }
  }
  // 邀请人账号太新
  if (inviter.createdAt && (ts - inviter.createdAt) < cfg.minInviterAgeHours * 3600000) {
    return { ok: false, reason: 'inviter_too_new' }
  }

  return { ok: true }
}

/**
 * 算出「还没发过」的奖励。
 *
 * 幂等靠 issued 里的 key：「register:1」「first_order:2」这种按组编号，
 * 发过一次就再也不会重发——哪怕结算任务一天跑十遍。
 *
 * @param {Array} invitees [{ registeredAt, firstOrderAt }]
 * @param {Array|Set} issued 已发放过的 key
 * @returns {Array<{key, type, amount, teamIndex}>}
 */
function dueRewards(invitees, issued, rules) {
  const cfg = Object.assign({}, RULES, rules || {})
  const done = {}
  ;(issued || []).forEach(function (k) { done[k] = true })

  const list = invitees || []
  const registered = list.length
  const firstOrdered = list.filter(function (i) {
    if (!i.firstOrderAt) return false
    if (!i.registeredAt) return true
    return ((i.firstOrderAt - i.registeredAt) / 86400000) <= cfg.firstOrderWindowDays
  }).length

  const out = []
  const regTeams = Math.floor(registered / cfg.teamSize)
  for (let i = 1; i <= regTeams; i++) {
    const key = 'register:' + i
    if (done[key]) continue
    out.push({ key: key, type: 'register_team', amount: cfg.registerReward, teamIndex: i })
  }

  const orderTeams = Math.floor(firstOrdered / cfg.teamSize)
  for (let i = 1; i <= orderTeams; i++) {
    const key = 'first_order:' + i
    if (done[key]) continue
    out.push({ key: key, type: 'first_order_team', amount: cfg.firstOrderReward, teamIndex: i })
  }

  return out
}

module.exports = {
  RULES: RULES,
  dueRewards: dueRewards,
  genCode: genCode,
  calcInviteReward: calcInviteReward,
  validateInvite: validateInvite,
}
