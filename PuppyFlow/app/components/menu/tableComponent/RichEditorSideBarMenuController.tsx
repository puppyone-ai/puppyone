import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import RichEditorSideBarMenu from './RichEditorSideBarMenu'
import { useState, useEffect, useRef } from 'react'
import { Editor } from '@tiptap/react'

type RichEditorSideBarMenuControllerProps = {
  editor: Editor,
  setIsLocalEdit: React.Dispatch<React.SetStateAction<boolean>>,
  preventParentDrag: () => void,
  allowParentDrag: () => void
}

const RichEditorSideBarMenuController = ({ editor, setIsLocalEdit, preventParentDrag, allowParentDrag }: RichEditorSideBarMenuControllerProps) => {
  const [showMenu, setShowMenu] = useState(false)
  const menuTriggerRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    const mouseClickHandler = (event: MouseEvent) => {
      if (menuTriggerRef.current && !menuTriggerRef.current.contains(event.target as Node)) {
        console.log('clicked outside')
        setShowMenu(false)
      }
    }
    document.addEventListener('click', mouseClickHandler)

    return () => {
      document.removeEventListener('click', mouseClickHandler)
    }
  }, [])


  // 鼠标进入和离开时，阻止父级元素的拖拽, wrapper是覆盖在整体的内容之上的，所以需要阻止事件冒泡并且阻止父级元素的拖拽也必须在这上面进行
  return (
    <NodeViewWrapper className="paragraph-with-menu" onMouseEnter={(e: React.MouseEvent) => {
      e.stopPropagation()
      preventParentDrag()
      
    }} onMouseLeave={(e: React.MouseEvent) => {
      e.stopPropagation()
      allowParentDrag()
    }} >
      <div ref={menuTriggerRef} className="menu-trigger"
           onClick={() => {
            const newState = !showMenu
            setShowMenu(newState)
            menuTriggerRef.current?.classList.toggle('active', newState)
           }}
           >
        <span className="menu-dot">⋮</span>
        {showMenu && <RichEditorSideBarMenu editor={editor} setIsLocalEdit={setIsLocalEdit} />}
      </div>
      <NodeViewContent className="paragraph-content" />
    </NodeViewWrapper>
  )
}

export default RichEditorSideBarMenuController
