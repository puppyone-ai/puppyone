import { Editor } from '@tiptap/react'
import { Level } from '@tiptap/extension-heading'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Quote,
  Heading1,
  Heading2,
  Heading3,
} from 'lucide-react'

interface MenuBarProps {
  editor: Editor | null
}

export const TipTapMenuBar = ({ editor }: MenuBarProps) => {
  if (!editor) return null

  const toggleHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    editor.chain().focus().toggleHeading({ level: level }).run()
  }

  return (
    <div className="menu-bar fixed top-[-40px] left-0 w-full h-[40px]">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'is-active' : ''}
      >
        <Bold size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'is-active' : ''}
      >
        <Italic size={18} />
      </button>
      <button
        onClick={() => toggleHeading(1)}
        className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
      >
        <Heading1 size={18} />
      </button>
      <button
        onClick={() => toggleHeading(2)}
        className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
      >
        <Heading2 size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive('bulletList') ? 'is-active' : ''}
      >
        <List size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? 'is-active' : ''}
      >
        <ListOrdered size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={editor.isActive('codeBlock') ? 'is-active' : ''}
      >
        <Code size={18} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive('blockquote') ? 'is-active' : ''}
      >
        <Quote size={18} />
      </button>
    </div>
  )
}