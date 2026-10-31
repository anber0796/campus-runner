const waves = require('../lib/waves')
const studentLib = require('../lib/student')

module.exports = {
  'student.get': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    let s = await studentLib.getStudent(db, openid)
    if (!s) s = studentLib.blank(openid)

    const missing = []
    if (!s.name) { missing.push('实名信息') }
    if (!s.healthExpire) { missing.push('健康证') }
    if (!s.waveIds || !s.waveIds.length) { missing.push('下课波次') }

    return { student: s, wave: waves.nextWave(new Date()), missing: missing }
  },

  'student.save': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const p = args.event.profile || {}
    const existing = await studentLib.getStudent(db, openid)

    const patch = {
      name: p.name || '',
      studentNo: p.studentNo || '',
      phone: p.phone || '',
      buildingId: p.buildingId || '',
      buildingName: p.buildingName || '',
      room: p.room || '',
      canteenIds: p.canteenIds || [],
      canteenNames: p.canteenNames || [],
      waveIds: p.waveIds || [],
      platformRiderId: p.platformRiderId || '',
      healthExpire: p.healthExpire || '',
      // TODO(合规)：生产环境这里应先落 pending，由运营核对健康证后再置 active。
      // MVP 阶段为了跑通链路先直接激活。
      status: 'active',
      updatedAt: Date.now(),
    }

    if (existing) {
      await db.collection(studentLib.COLL).doc(existing._id).update({ data: patch })
      return { student: Object.assign({}, existing, patch) }
    }

    const doc = Object.assign(studentLib.blank(openid), patch)
    const r = await db.collection(studentLib.COLL).add({ data: doc })
    return { student: Object.assign({ _id: r._id }, doc) }
  },
}
