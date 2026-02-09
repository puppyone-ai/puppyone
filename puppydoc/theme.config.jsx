import { LanguageSwitcher } from './components/LanguageSwitcher'

export default {
  logo: <span style={{ fontWeight: 600 }}>PuppyOne</span>,
  
  project: {
    link: 'https://github.com/puppyone-ai/puppyone'
  },
  
  docsRepositoryBase: 'https://github.com/puppyone-ai/puppyone/tree/main/puppydoc/pages',

  // 语言切换器放在 Header 右侧
  navbar: {
    extraContent: <LanguageSwitcher />
  },

  footer: {
    text: (
      <span>
        {new Date().getFullYear()} ©{' '}
        <a href="https://puppyone.ai" target="_blank" rel="noopener noreferrer">
          PuppyOne
        </a>
      </span>
    )
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
