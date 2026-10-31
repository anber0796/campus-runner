/**
 * 状态机 —— PRD 8.7 的第二个坑：旧状态覆盖新状态。
 *
 * 做法：条件更新 + 版本号。只有当「当前状态仍是 from 且版本号没变」时才允许写，
 * 影响行数为 0 就说明别人已经改过了，直接抛 409 让客户端刷新，绝不覆盖。
 */
const TRANSITIONS = {
  CREATED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PACKED', 'CANCELLED'],
  PACKED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['PICKED'],
  PICKED: ['DELIVERED'],
  DELIVERED: [],
}

function canTransit(from, to) {
  const allowed = TRANSITIONS[from] || []
  return allowed.indexOf(to) >= 0
}

/**
 * @param {Object} db       wx-server-sdk 的 database 实例
 * @param {String} coll     集合名
 * @param {String} id       文档 _id
 * @param {String} from     期望的当前状态
 * @param {String} to       目标状态
 * @param {Object} extra    附加写入字段
 */
async function transition(db, coll, id, from, to, extra) {
  if (!canTransit(from, to)) {
    const err = new Error('非法状态迁移: ' + from + ' → ' + to)
    err.code = 400
    throw err
  }

  const _ = db.command
  const patch = Object.assign({}, extra || {}, {
    status: to,
    updatedAt: Date.now(),
    version: _.inc(1),
  })

  const res = await db.collection(coll)
    .where({ _id: id, status: from })
    .update({ data: patch })

  const updated = res && res.stats ? res.stats.updated : 0
  if (updated !== 1) {
    const err = new Error('状态已变化，请刷新后重试')
    err.code = 409
    throw err
  }
  return true
}

module.exports = { TRANSITIONS: TRANSITIONS, canTransit: canTransit, transition: transition }
