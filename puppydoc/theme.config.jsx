import { LanguageSwitcher } from './components/LanguageSwitcher'

export default {
  logo: (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <img src="/doc/puppyone-logo.svg" alt="PuppyOne" width={24} height={24} style={{ borderRadius: 6 }} />
      <span style={{ fontWeight: 600 }}>puppyone</span>
    </span>
  ),
  
  project: {
    link: 'https://github.com/puppyone-ai/puppyone'
  },
  
  docsRepositoryBase: 'https://github.com/puppyone-ai/puppyone/tree/main/puppydoc/pages',

  // 语言切换器放在 Header 右侧
  navbar: {
    extraContent: <LanguageSwitcher />
  },

  footer: {
    component: () => null,
  },

  useNextSeoProps() {
    return {
      titleTemplate: '%s – PuppyOne'
    }
  },

  sidebar: {
    defaultMenuCollapseLevel: 1,
  },

  navigation: {
    prev: true,
    next: true,
  },
}
