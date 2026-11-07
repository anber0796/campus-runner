const riderApi = require('../../utils/riderApi')
const fmt = require('../../utils/format')
const group = require('../../utils/group')

function leftText(deadline) {
  if (!deadline) return ''
  const ms = deadline - Date.now()
  if (ms <= 0) return '已截止'
  const min = Math.floor(ms / 60000)
  return min < 1 ? '即将截止' : '剩 ' + min + ' 分'
}

function fmtTime(ts) {
  const d = new Date(ts)
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function remainTextOf(b) {
  if (!b) return ''
  if (b.status === 'DELIVERED') {
    const late = (b.orderList || []).reduce(function (m, o) {
      if (!o.dueAt || !o.deliveredAt) return m
      return Math.max(m, o.deliveredAt - o.dueAt)
    }, -Infinity)
    if (!isFinite(late)) return ''
    return late > 0 ? '超时 ' + Math.round(late / 60000) + ' 分' : '准时'
  }
  const t = fmt.tightest(b.orderList, Date.now())
  return t ? t.text : ''
}

function remainLevelOf(b) {
  if (!b) return ''
  if (b.status === 'DELIVERED') {
    return remainTextOf(b).indexOf('超时') === 0 ? 'over' : 'ok'
  }
  const t = fmt.tightest(b.orderList, Date.now())
  return t ? t.level : ''
}

const STATUS = {
  ASSIGNED: { text: '待取餐', cls: 'tag tag-amber' },
  CLAIMED: { text: '待取餐', cls: 'tag tag-amber' },
  PICKED: { text: '待送达', cls: 'tag' },
  DELIVERED: { text: '已完成', cls: 'tag tag-green' },
}

/**
 * 待取餐按「食堂 + 波次」合并：
 * 骑手只去一次食堂，分批对他没有意义。同一食堂抢了好几批，就当成一趟活。
 * 合并后重新按楼层梳理商家，动线才连贯。
 */
function mergeByCanteen(batches) {
  const map = {}
  ;(batches || []).forEach(function (b) {
    const key = b.canteenId + '|' + b.waveId
    if (!map[key]) {
      map[key] = {
        key: key,
        canteenId: b.canteenId,
        canteenName: b.canteenName,
        waveId: b.waveId,
        batches: [],
      }
    }
    map[key].batches.push(b)
  })

  const groups = Object.keys(map).map(function (k) {
    const g = map[k]
    const orders = []
    const buildings = []

    g.batches.forEach(function (b) {
      ;(b.orderList || []).forEach(function (o) {
        orders.push(Object.assign({}, o, { batchId: b.id }))
      })
      const bt = (b.buildingIds || [b.buildingId]).join('+')
      if (buildings.indexOf(bt) < 0) buildings.push(bt)
    })

    // 合并后重新按档口楼层梳理
    const byFloor = {}
    orders.forEach(function (o) {
      const f = o.stallFloor || 1
      if (!byFloor[f]) byFloor[f] = []
      byFloor[f].push(o)
    })
    const stallLines = Object.keys(byFloor)
      .map(Number)
      .sort(function (a, b) { return a - b })
      .map(function (f) {
        const names = []
        byFloor[f].forEach(function (o) {
          if (o.stallName && names.indexOf(o.stallName) < 0) names.push(o.stallName)
        })
        return { floor: f, stallText: names.join('、'), count: byFloor[f].length }
      })

    const t = fmt.tightest(orders)
    // 合并后的金额 = 各批单价 × 各批单数 之和
    const earn = g.batches.reduce(function (sum, b) {
      return sum + (Number(b.price) || 0) * (b.orderCount || 0)
    }, 0)

    return {
      key: k,
      canteenId: g.canteenId,
      canteenName: g.canteenName,
      waveId: g.waveId,
      buildingTexts: buildings.join(' / '),
      orderCount: orders.length,
      orderText: orders.length + ' 单',
      earnText: '¥' + (Math.round(earn * 100) / 100),
      stallLines: stallLines,
      stallMore: Math.max(0, stallLines.length - 3),
      remainText: t ? t.text : '',
      remainLevel: t ? t.level : '',
      tightestMin: t ? t.min : 9999,
      batchIds: g.batches.map(function (b) { return b.id }),
    }
  })

  return groups.sort(function (a, b) { return a.tightestMin - b.tightestMin })
}

/**
 * 待送达按「楼栋 → 楼层」聚合。
 * 骑手关心的是"去几栋、每栋爬几层"，不是"这是哪一批"。
 */
function mergeByBuilding(batches) {
  const orders = []
  ;(batches || []).forEach(function (b) {
    const fallback = (b.buildingIds && b.buildingIds.length === 1)
      ? b.buildingIds[0]
      : b.buildingId
    ;(b.orderList || []).forEach(function (o) {
      if (o.picked && !o.delivered) {
        orders.push(Object.assign({}, o, {
          batchId: b.id,
          buildingText: o.buildingId || o.buildingName || fallback,
        }))
      }
    })
  })

  // 分组交给公共工具，这里只补剩余时间
  return group.buildings(orders).map(function (g) {
    const t = fmt.tightest(
      g.floors.reduce(function (acc, f) { return acc.concat(f.orders) }, [])
    )
    return Object.assign({}, g, {
      orderText: g.count + ' 单',
      remainText: t ? t.text : '',
      remainLevel: t ? t.level : '',
    })
  })
}

Page({
  data: {
    loading: true,
    error: '',
    tab: 'pool',
    pool: [],
    poolGroups: [],
    openGroups: {},
    pick: [],
    deliver: [],
    deliverGroups: [],
    done: [],
    student: null,
    canClaim: null,
    busy: false,
    needCert: false,
    showGuide: false,
    retryable: true,
  },

  onShow() {
    if (!wx.getStorageSync('onboarded')) {
      this.setData({ showGuide: true })
    }
    this.load()
    const that = this
    clearInterval(this._timer)
    this._timer = setInterval(function () { that.tick() }, 20000)
  },

  onHide() { clearInterval(this._timer) },
  onUnload() { clearInterval(this._timer) },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })

    Promise.all([riderApi.home(), riderApi.myBatches()])
      .then(function (res) {
        const home = res[0] || {}
        const mine = res[1] || {}
        const active = mine.active || []

        const decorateBatch = function (b) {
          const st = STATUS[b.status] || { text: b.status, cls: 'tag tag-gray' }
          return Object.assign({}, b, {
            statusText: st.text,
            statusClass: st.cls,
            earn: b.earn || 0,
            orderCount: b.orderCount || 0,
            earnText: '¥' + (b.earn || 0),
            priceText: b.price ? '¥' + b.price + '/单' : '',
            buildingText: (b.buildingIds || [b.buildingId]).join(' + '),
            tailText: (b.tails || []).join(' / '),
            orderText: b.orderCount + ' 单',
            leftText: leftText(b.claimDeadline),
            urgent: leftText(b.claimDeadline) === '即将截止',
            walkText: b.walkMinutes ? '步行 ' + b.walkMinutes + ' 分钟' : '',
            remainText: remainTextOf(b),
            remainLevel: remainLevelOf(b),
            timeText: b.deliveredAt ? fmtTime(b.deliveredAt) : '',
          })
        }

        that.setData({
          loading: false,
          student: home.student || null,
          canClaim: home.canClaim || null,
          pool: (home.batches || []).map(decorateBatch),
          poolGroups: applyOpen(groupPoolByCanteen((home.batches || []).map(decorateBatch)), that.data.openGroups),
          pick: mergeByCanteen(active.filter(function (b) {
            return b.status === 'ASSIGNED' || b.status === 'CLAIMED'
          })),
          deliver: active.filter(function (b) { return b.status === 'PICKED' }).map(decorateBatch),
          deliverGroups: mergeByBuilding(active.filter(function (b) { return b.status === 'PICKED' })),
          done: (mine.finished || []).map(decorateBatch),
        })
      })
      .catch(function (e) {
        if (e.code === 403) {
          that.setData({ loading: false, needCert: true, error: '' })
          return
        }
        that.setData({
          loading: false,
          error: e.message || '加载失败',
          retryable: e.code !== 'UNKNOWN',
        })
      })
  },

  tick() {
    const remap = function (list) {
      return (list || []).map(function (b) {
        return Object.assign({}, b, {
          remainText: remainTextOf(b),
          remainLevel: remainLevelOf(b),
        })
      })
    }
    this.setData({
      deliver: remap(this.data.deliver),
      deliverGroups: mergeByBuilding(this.data.deliver.filter(function (b) {
        return b.status === 'PICKED'
      })),
    })

    if (!this.data.pool.length) return
    let expired = false
    const pool = this.data.pool.map(function (b) {
      const t = leftText(b.claimDeadline)
      if (t === '已截止') expired = true
      return Object.assign({}, b, {
        leftText: t,
        urgent: t === '即将截止' || t === '已截止',
        remainText: remainTextOf(b),
        remainLevel: remainLevelOf(b),
      })
    })
    this.setData({
      pool: pool,
      poolGroups: applyOpen(groupPoolByCanteen(pool), this.data.openGroups),
    })
    if (expired) this.load()
  },

  retry() { this.load() },

  dismissGuide() {
    wx.setStorageSync('onboarded', 1)
    this.setData({ showGuide: false })
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  toggleGroup(e) {
    const idx = e.currentTarget.dataset.idx
    const g = this.data.poolGroups[idx]
    if (!g) return

    const open = Object.assign({}, this.data.openGroups)
    open[g.key] = !g.open

    const patch = { openGroups: open }
    patch['poolGroups[' + idx + '].open'] = !g.open
    this.setData(patch)
  },

  grab(e) {
    const that = this
    const id = e.currentTarget.dataset.id
    const target = this.data.pool.filter(function (b) { return b.id === id })[0]
    if (!target || this.data.busy) return

    wx.showModal({
      title: '抢这一批？',
      content: target.canteenName + ' → ' + target.buildingText + ' · ' + target.orderText + ' · 到手 ' + target.earnText,
      confirmText: '抢',
      success: function (res) {
        if (!res.confirm) return
        that.setData({ busy: true })
        riderApi
          .grab(id)
          .then(function () {
            // 留在可抢单：学生通常要连抢几个食堂/几栋楼，别把他踢走
            that.setData({ busy: false })
            wx.showToast({ title: '抢到了，可继续抢', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            that.setData({ busy: false })
            that.load()

            const taken = err.code === 409 || String(err.message || '').indexOf('手慢') >= 0
            if (taken) {
              wx.showModal({
                title: '这一批被抢走了',
                content: '别人比你快一步。要不要看看其他批次？',
                confirmText: '看别的',
                cancelText: '知道了',
                success: function (r) { if (r.confirm) that.setData({ tab: 'pool' }) },
              })
              return
            }
            wx.showToast({ title: err.message || '没抢到', icon: 'none' })
          })
      },
    })
  },

  // 待取餐：按食堂合并后进取餐页
  // 放弃：抢错了或临时有事，退回池子（比超时收回轻，不扣分）
  releaseBatch(e) {
    const that = this
    const batchId = e.currentTarget.dataset.batch
    const canteen = e.currentTarget.dataset.canteen || '这一批'

    wx.showModal({
      title: '放弃这一批？',
      content: canteen + ' 会退回抢单池，别人可以抢。放弃不扣信用分，但会计次。',
      confirmText: '放弃',
      cancelText: '再想想',
      success: function (res) {
        if (!res.confirm) return
        riderApi
          .release(batchId)
          .then(function () {
            wx.showToast({ title: '已退回抢单池', icon: 'none' })
            that.load()
          })
          .catch(function (err) {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' })
          })
      },
    })
  },

  goPickup(e) {
    const g = this.data.pick[e.currentTarget.dataset.index]
    if (!g) return
    // canteenId 缺失时退回用名字匹配，别把 undefined 拼进 URL
    const key = g.canteenId || g.canteenName
    wx.navigateTo({
      url: '/pages/pickup/pickup?canteen=' + encodeURIComponent(key) + '&wave=' + (g.waveId || ''),
    })
  },

  goDeliver(e) {
    const building = (e && e.currentTarget && e.currentTarget.dataset.building) || ''
    wx.navigateTo({
      url: '/pages/delivery/delivery' + (building ? '?building=' + encodeURIComponent(building) : ''),
    })
  },
})
