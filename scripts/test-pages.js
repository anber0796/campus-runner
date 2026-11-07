/**
 * 页面级静态检查
 *
 *   node scripts/test-pages.js
 *
 * 引擎有 200 多个断言，但界面一直靠人眼验证——今天连出三个 bug 就是这来的。
 * 这个脚本不测交互，只守住几件"编译期就该发现"的事：
 *   1. app.json 里注册的页面，文件真的存在
 *   2. tabBar 指向的页面都注册过
 *   3. 每个页面都调用了 Page()
 *   4. require 的模块真的存在（删文件忘改引用）
 *   5. wxml 标签配对
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

const app = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'))

function fileExists(rel) {
  return fs.existsSync(path.join(MP, rel))
}

test('app.json 注册的页面都有 .js 和 .wxml', function () {
  const missing = []
  app.pages.forEach(function (p) {
    ;['js', 'wxml'].forEach(function (ext) {
      if (!fileExists(p + '.' + ext)) missing.push(p + '.' + ext)
    })
  })
  if (missing.length) throw new Error('缺少文件: ' + missing.join(', '))
})

test('tabBar 指向的页面都已注册', function () {
  const bad = (app.tabBar.list || [])
    .filter(function (t) { return app.pages.indexOf(t.pagePath) < 0 })
    .map(function (t) { return t.pagePath })
  if (bad.length) throw new Error('未注册: ' + bad.join(', '))
})

test('每个页面都调用了 Page()', function () {
  const bad = app.pages.filter(function (p) {
    const src = fs.readFileSync(path.join(MP, p + '.js'), 'utf8')
    return src.indexOf('Page(') < 0
  })
  if (bad.length) throw new Error('没有 Page(): ' + bad.join(', '))
})

test('页面里 require 的模块都存在', function () {
  const bad = []
  app.pages.forEach(function (p) {
    const file = path.join(MP, p + '.js')
    const src = fs.readFileSync(file, 'utf8')
    const re = /require\(['"](\.[^'"]+)['"]\)/g
    let m
    while ((m = re.exec(src))) {
      const target = path.resolve(path.dirname(file), m[1])
      if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) {
        bad.push(p + ' → ' + m[1])
      }
    }
  })
  if (bad.length) throw new Error('引用丢失: ' + bad.join(', '))
})

test('wxml 标签配对（view / block / text / scroll-view）', function () {
  const bad = []
  app.pages.forEach(function (p) {
    const src = fs.readFileSync(path.join(MP, p + '.wxml'), 'utf8')
    ;['view', 'block', 'text', 'scroll-view'].forEach(function (tag) {
      const opens = (src.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length
      const closes = (src.match(new RegExp('</' + tag + '>', 'g')) || []).length
      if (opens !== closes) bad.push(p + ' 的 <' + tag + '> 开 ' + opens + ' 闭 ' + closes)
    })
  })
  if (bad.length) throw new Error(bad.join('; '))
})

test('没有引用已删除的旧工具 (utils/api, utils/mock)', function () {
  const bad = []
  function walk(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      const p = path.join(dir, f)
      const st = fs.statSync(p)
      if (st.isDirectory()) return walk(p)
      if (!p.endsWith('.js')) return
      const src = fs.readFileSync(p, 'utf8')
      if (/require\(['"][^'"]*utils\/api['"]\)/.test(src)) bad.push(p)
      if (/require\(['"][^'"]*utils\/mock['"]\)/.test(src)) bad.push(p)
    })
  }
  walk(MP)
  if (bad.length) throw new Error('仍在引用: ' + bad.join(', '))
})

test('不再注册已下线的旧页面', function () {
  const gone = ['pages/index/index', 'pages/pack/pack', 'pages/order/order', 'pages/deliver/deliver']
  const still = gone.filter(function (g) { return app.pages.indexOf(g) >= 0 })
  if (still.length) throw new Error('仍然注册着: ' + still.join(', '))
})

test('utils/group.js 被三个页面复用（不再各写一份）', function () {
  const pages = ['pages/tasks/tasks', 'pages/pickup/pickup', 'pages/delivery/delivery']
  const missing = pages.filter(function (p) {
    const src = fs.readFileSync(path.join(MP, p + '.js'), 'utf8')
    return src.indexOf('utils/group') < 0
  })
  if (missing.length) throw new Error('没复用公共分组: ' + missing.join(', '))
})

console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
