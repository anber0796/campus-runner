const riderApi = require('../../utils/riderApi')
const fmt = require('../../utils/format')
const group = require('../../utils/group')

Page({
  data: {
    loading: true,
    error: '',
    groups: [],
    total: 0,
    done: false,
    busy: false,
    primary: null,
  },

  onLoad(query) {
    // 从待送达某栋点进来时只显示那一栋，别把别的楼混进来
    this.building = (query && query.building) ? decodeURIComponent(query.building) : ''
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })

    riderApi
      .myBatches()
      .then(function (d) {
        const active = d.active || []
        const all = []

        // 把每一批里"已取未送"的单抽出来，并记住它属于哪一批
        active.forEach(function (b) {
          const fallback = (b.buildingIds && b.buildingIds.length === 1)
            ? b.buildingIds[0]
            : b.buildingId
          ;(b.orderList || []).forEach(function (o) {
            if (o.picked && !o.delivered) {
              all.push(Object.assign({}, o, {
                batchId: b.id,
                buildingText: o.buildingId || o.buildingName || fallback,
                buildingId: o.buildingId || fallback,
              }))
            }
          })
        })

        // 只保留指定楼栋的单
        const filtered = that.building
          ? all.filter(function (o) { return (o.buildingText || '') === that.building })
          : all

        if (!filtered.length) {
          that.setData({
            loading: false, groups: [], total: 0, done: true, primary: null,
            heading: that.building || '',
          })
          return
        }

        // 每单算剩余时间
        const now = Date.now()
        filtered.forEach(function (o) {
          const r = fmt.remain(o.dueAt, now)
          o.remainText = r ? r.text : ''
          o.remainLevel = r ? r.level : ''
        })

        // 全局排序后的下一单，供底部主按钮用
        const sorted = filtered.slice().sort(function (a, b) {
          const ba = String(a.buildingText || '')
          const bb = String(b.buildingText || '')
          if (ba !== bb) return ba.localeCompare(bb)
          return (b.floor || 0) - (a.floor || 0)
        })

        that.setData({
          loading: false,
          groups: group.buildings(filtered),
          total: filtered.length,
          heading: that.building || '',
          done: false,
          primary: { targetId: sorted[0].id, batchId: sorted[0].batchId, tail: sorted[0].tail },
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  // 点一下直接开相机，拍完自动提交
  deliver(e) {
    if (this.data.busy) return
    const that = this
    const orderId = e.currentTarget.dataset.id
    const batchId = e.currentTarget.dataset.batch

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      success: function (res) {
        const photo = res.tempFiles[0].tempFilePath
        that.setData({ busy: true })
        riderApi
          .deliver(batchId, orderId, photo)
          .then(function () {
            that.setData({ busy: false })
            wx.showToast({ title: '已送达', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            that.setData({ busy: false })
            wx.showToast({ title: err.message || '提交失败', icon: 'none' })
          })
      },
    })
  },

  primaryTap() {
    const p = this.data.primary
    if (!p || this.data.busy) return
    this.deliver({ currentTarget: { dataset: { id: p.targetId, batch: p.batchId } } })
  },

  goTasks() {
    wx.navigateBack()
  },
})
