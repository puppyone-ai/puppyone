import React from 'react'
import { Editor } from '@tiptap/react'

type RichEditorSideBarMenuProps = {
  editor: Editor
  setIsLocalEdit: React.Dispatch<React.SetStateAction<boolean>>
}

const RichEditorSideBarMenu = ({ editor, setIsLocalEdit }: RichEditorSideBarMenuProps) => {

    const awaitingCommand = () => {
        return new Promise<void>((resolve) => {
          // 使用 requestAnimationFrame 确保状态更新已完成
          requestAnimationFrame(() => {
            setIsLocalEdit(true)
            // 再次使用 requestAnimationFrame 确保上述状态更新已应用
            requestAnimationFrame(() => {
              resolve()
            })
          })
        })
      }
    
    const handleCommand = async (command: () => void) => {
        // console.log("handleCommand before", editor.getHTML())
      await awaitingCommand()
      command()
    //   editor.commands.focus('end')
    //   const newContent = editor.getHTML()
    //   console.log("handleCommand after: newContent ~~~", newContent)
    //   editor.commands.setContent(newContent)
    }

    return (
      <div className="absolute left-0 top-[20px] flex flex-col gap-2 bg-main-black-theme shadow-lg rounded-md p-2 border-[2px] border-[#CDCDCD] z-[100]">
        <button className="menu-item" onClick={() => {
          handleCommand(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
        // editor.chain().focus().toggleHeading({ level: 1 }).run()
           
        }}>Heading 1</button>
        <button className="menu-item"
        onClick={() => {
          handleCommand(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
        // editor.chain().focus().toggleHeading({ level: 2 }).run()
     
        }}>Heading 2</button>
        <button className="menu-item"
        onClick={() => {
          handleCommand(() => editor.chain().focus().toggleHeading({ level: 3 }).run())
        // editor.chain().focus().toggleHeading({ level: 3 }).run()
     
        }}>Heading 3</button>
        <button className="menu-item"
        onClick={() => {
          handleCommand(() => editor.chain().focus().setParagraph().run())
        // editor.chain().focus().setParagraph().run()
     
        }}>Paragraph</button>
      </div>
    )
  }

export default RichEditorSideBarMenu