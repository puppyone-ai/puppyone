import { useRouter } from 'next/router'

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' },
]

export function LanguageSwitcher() {
  const router = useRouter()
  const { asPath } = router
  
  // 检测当前语言
  const currentLang = asPath.startsWith('/zh') ? 'zh' : 'en'
  
  const switchLanguage = (targetLang) => {
    if (targetLang === currentLang) return
    
    let newPath
    if (asPath === '/' || asPath === '') {
      newPath = `/${targetLang}`
    } else if (asPath.startsWith('/en')) {
      newPath = asPath.replace(/^\/en/, `/${targetLang}`)
    } else if (asPath.startsWith('/zh')) {
      newPath = asPath.replace(/^\/zh/, `/${targetLang}`)
    } else {
      newPath = `/${targetLang}${asPath}`
    }
    
    router.push(newPath)
  }
  
  return (
    <select 
      value={currentLang} 
      onChange={(e) => switchLanguage(e.target.value)}
      style={{ 
        height: 28, 
        fontSize: 14,
        padding: '0 8px',
        borderRadius: 4,
        border: '1px solid #333',
        background: '#111',
        color: '#ccc',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {LANGUAGES.map(lang => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  )
}









