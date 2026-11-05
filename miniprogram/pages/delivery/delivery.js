const riderApi = require('../../utils/riderApi')

Page({
  data: {
    loading: true,
    error: '',
    current: null,
    list: [],
    remaining: 0,
    done: false,
    busy: false,
    primary: null,
  },

  onLoad(query) {
    this.wantId = (query && query.id) || ''
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
        const target = that.wantId
          ? active.filter(function (b) { return b.id === that.wantId })[0]
          : active[0]

        if (!target) {
          that.setData({ loading: false, current: null, list: [], done: true, primary: null })
          return
        }
        that.render(target)
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  render(batch) {
    // 只列还没送的，按寝室楼层从高到低——送完一路往下走
    const list = (batch.orderList || [])
      .filter(function (o) { return o.picked && !o.delivered })
      .slice()
      .sort(function (a, b) { return (b.floor || 0) - (a.floor || 0) })

    const remaining = list.length
    const primary = remaining
      ? { targetId: list[0].id, tail: list[0].tail }
      : null

    this.setData({
      loading: false,
      current: batch,
      list: list,
      remaining: remaining,
      done: remaining === 0,
      primary: primary,
    })
  },

  // 点一下直接开相机，拍完自动提交
  deliver(e) {
    if (this.data.busy) return
    const that = this
    const orderId = e.currentTarget.dataset.id

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      success: function (res) {
        const photo = res.tempFiles[0].tempFilePath
        that.setData({ busy: true })
        riderApi
          .deliver(that.data.current.id, orderId, photo)
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
    this.deliver({ currentTarget: { dataset: { id: p.targetId } } })
  },

  goTasks() {
    wx.navigateBack()
  },
})
