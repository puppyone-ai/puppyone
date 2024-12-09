import { Extension, Editor, Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        char: '/',
        editor: this.editor,
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ query }) => {
          return [
            {
              title: 'Text',
              command: ({ editor, range }: {editor: Editor, range: Range}) => {
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .toggleNode('paragraph', 'paragraph')
                  .run()
              },
            },
            {
              title: 'Heading 1',
              command: ({ editor, range }: {editor: Editor, range: Range}) => {
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .setNode('heading', { level: 1 })
                  .run()
              },
            },
            {
              title: 'Bullet List',
              command: ({ editor, range }: {editor: Editor, range: Range}) => {
                editor
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .toggleBulletList()
                  .run()
              },
            },
            // 添加更多命令...
          ].filter(item => item.title.toLowerCase().startsWith(query.toLowerCase()))
        },
      }),
    ]
  },
})