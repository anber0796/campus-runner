const riderApi = require('../../utils/riderApi')

Page({
  data: {
    loading: true,
    error: '',
    code: '',
    bound: false,
    registered: 0,
    firstOrdered: 0,
    amount: 0,
    nextRegisterGap: 10,
    nextOrderGap: 10,
    regPercent: 0,
    orderPercent: 0,
    inputCode: '',
    binding: false,
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    riderApi
      .invite()
      .then(function (d) {
        // 当前这一组的完成度：刚好整除时显示 100%，避免"拉满 10 人却显示 0/10"
        const pct = function (n) {
          const r = n % 10
          return (r === 0 && n > 0) ? 100 : r * 10
        }
        that.setData({
          loading: false,
          bound: !!d.bound,
          code: d.code,
          registered: d.registered,
          firstOrdered: d.firstOrdered,
          amount: d.amount,
          nextRegisterGap: d.nextRegisterGap,
          nextOrderGap: d.nextOrderGap,
          regPercent: pct(d.registered),
          orderPercent: pct(d.firstOrdered),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.code })
  },

  onInput(e) {
    this.setData({ inputCode: e.detail.value })
  },

  bind() {
    const that = this
    const code = this.data.inputCode.trim()
    if (!code) return wx.showToast({ title: '请输入邀请码', icon: 'none' })
    if (this.data.binding) return

    this.setData({ binding: true })
    riderApi
      .bindInvite(code)
      .then(function (d) {
        that.setData({ binding: false, inputCode: '' })
        wx.showToast({ title: '已绑定', icon: 'success' })
      })
      .catch(function (e) {
        that.setData({ binding: false })
        wx.showToast({ title: e.message || '绑定失败', icon: 'none' })
      })
  },
})
