import { useRouter } from 'next/router'

const TITLE = {
  en: 'PuppyOne',
  zh: 'PuppyOne',
}

const EDIT_TEXT = {
  en: 'Edit this page on GitHub →',
  zh: '在 GitHub 上编辑此页 →',
}

const FEEDBACK_TEXT = {
  en: 'Question? Give us feedback →',
  zh: '有问题？给我们反馈 →',
}

const TOC_TITLE = {
  en: 'On This Page',
  zh: '目录',
}

const SEARCH_PLACEHOLDER = {
  en: 'Search documentation...',
  zh: '搜索文档...',
}

export default {
  logo: <span style={{ fontWeight: 600 }}>PuppyOne</span>,
  
  project: {
    link: 'https://github.com/puppyone-ai/puppyone'
  },
  
  docsRepositoryBase: 'https://github.com/puppyone-ai/puppyone/tree/main/puppydoc/pages',

  // 语言切换下拉框 - 显示在 Header 右侧
  i18n: [
    { locale: 'en', text: 'English' },
    { locale: 'zh', text: '中文' },
  ],

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
    const { locale } = useRouter()
    return {
      titleTemplate: `%s – ${TITLE[locale] || TITLE.en}`
    }
  },

  search: {
    placeholder: function usePlaceholder() {
      const { locale } = useRouter()
      return SEARCH_PLACEHOLDER[locale] || SEARCH_PLACEHOLDER.en
    }
  },

  toc: {
    title: function useTitle() {
      const { locale } = useRouter()
      return TOC_TITLE[locale] || TOC_TITLE.en
    }
  },

  editLink: {
    text: function useText() {
      const { locale } = useRouter()
      return EDIT_TEXT[locale] || EDIT_TEXT.en
    }
  },

  feedback: {
    content: function useContent() {
      const { locale } = useRouter()
      return FEEDBACK_TEXT[locale] || FEEDBACK_TEXT.en
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
