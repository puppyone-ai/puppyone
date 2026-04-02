const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.jsx',
})

const isProd = process.env.NODE_ENV === 'production'

module.exports = withNextra({
  ...(isProd ? { basePath: '/doc' } : {}),
})
