const adminApi = require('../../../utils/adminApi')

const STATUS = {
  available: { text: '待派', cls: 'tag' },
  accepted: { text: '已接单', cls: 'tag tag-green' },
  picked: { text: '已取餐', cls: 'tag' },
  fallback: { text: '已回落', cls: 'tag tag-amber' },
  delivered: { text: '已送达', cls: 'tag tag-green' },
}

Page({
  data: {
    username: '',
    loading: true,
    error: '',
    stats: null,
    packs: [],
    alerts: [],
    executing: false,
  },

  onShow() {
    if (!adminApi.getToken()) {
      wx.redirectTo({ url: '/pages/admin/login/login' })
      return
    }
    this.setData({ username: adminApi.getUsername() })
    this.load()
    this.loadWithdrawals()
  },

  onPullDownRefresh() {
    this.load()
    this.loadWithdrawals()
    wx.stopPullDownRefresh()
  },

  loadWithdrawals() {
    const that = this
    adminApi
      .withdrawals()
      .then(function (d) {
        that.setData({ withdrawals: d })
      })
      .catch(function () {})
  },

  payoutAll() {
    const that = this
    const list = this.data.withdrawals.items || []
    if (!list.length) return wx.showToast({ title: '没有待打款的申请', icon: 'none' })

    wx.showModal({
      title: '标记已打款',
      content: '共 ' + list.length + ' 笔 · ¥' + this.data.withdrawals.total + '。确认已经转账完成？',
      confirmText: '已打款',
      success: function (res) {
        if (!res.confirm) return
        adminApi
          .markWithdrawn(list.map(function (x) { return x.id }))
          .then(function (r) {
            wx.showToast({ title: '已标记 ' + r.updated + ' 笔', icon: 'success' })
            that.loadWithdrawals()
          })
          .catch(function (err) {
            wx.showToast({ title: err.message || '操作失败', icon: 'none' })
          })
      },
    })
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    adminApi.stats()
      .then(function (s) {
        that.setData({
          loading: false,
          stats: s,
          alerts: s.alerts || [],
        })
      })
      .catch(function (e) {
        if (e.code === 401) {
          wx.redirectTo({ url: '/pages/admin/login/login' })
          return
        }
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  // 兼容旧调用（页面已不再使用巡检按钮）
  execute() {
    if (this.data.executing) return
    const that = this
    this.setData({ executing: true })
    adminApi.execute()
      .then(function (r) {
        that.setData({ executing: false })
        if (!r.applied) {
          wx.showToast({ title: '没有需要执行的动作', icon: 'none' })
        } else {
          wx.showToast({ title: '已处理 ' + r.applied + ' 条', icon: 'success' })
        }
        that.load()
      })
      .catch(function (e) {
        that.setData({ executing: false })
        wx.showToast({ title: e.message || '执行失败', icon: 'none' })
      })
  },

  republish(e) {
    const that = this
    const packId = e.currentTarget.dataset.id
    wx.showModal({
      title: '重派回池',
      content: '把这个包放回池子重新推送？相关告警会标记为已处理。',
      success: function (res) {
        if (!res.confirm) return
        adminApi.republish(packId)
          .then(function () {
            wx.showToast({ title: '已重派', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            wx.showToast({ title: err.message || '重派失败', icon: 'none' })
          })
      },
    })
  },

  goChecklist() {
    wx.navigateTo({ url: '/pages/admin/checklist/checklist' })
  },

  goPost() {
    wx.navigateTo({ url: '/pages/admin/post/post' })
  },

  logout() {
    adminApi.clearSession()
    wx.redirectTo({ url: '/pages/admin/login/login' })
  },
})
