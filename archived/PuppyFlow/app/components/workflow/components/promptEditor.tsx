import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { nanoid } from 'nanoid';

// 定义类型
export type PromptRole = 'system' | 'user' | 'assistant';

export type PromptMessage = {
  role: PromptRole;
  content: string;
};

export type PromptNodeType = {
  id: string;
  role: PromptRole;
  content: string;
};

type PromptEditorProps = {
  // 只接受结构化数据，不再接受字符串
  messages: PromptMessage[];
  // 用于高亮显示的变量列表
  variables?: { name: string; type?: string }[];
  // 当编辑内容变化时的回调
  onChange: (messages: PromptMessage[]) => void;
  // 可选的事件处理器
  onFocus?: () => void;
  onBlur?: () => void;
};

// 创建一个工具函数处理高亮，不使用hook
const getHighlightedContent = (
  content: string,
  variables: { name: string; type?: string }[]
) => {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{\{([^{}]+)\}\}/g, (match, label) => {
      // 查找匹配的节点及其类型
      const sourceNode = variables.find(
        item => item.name.trim() === label.trim()
      );

      if (sourceNode) {
        // 根据节点类型应用不同的高亮颜色
        if (sourceNode.type === 'structured') {
          // 紫色主题 - 对应 structured 节点
          return `<span class="text-[#9B7EDB] rounded-sm">${match}</span>`;
        } else {
          // 蓝色主题 - 对应 text 节点（默认）
          return `<span class="text-[#3B9BFF] rounded-sm">${match}</span>`;
        }
      }
      // 如果不是源节点标签，则不添加高亮
      return match;
    });
};

const PromptEditor: React.FC<PromptEditorProps> = ({
  messages,
  variables = [],
  onChange,
  onFocus,
  onBlur,
}) => {
  // 引用原始messages以避免不必要的重新渲染
  const messagesRef = useRef(messages);

  // 将输入消息转换为内部节点格式 - 只在初始化时设置一次
  const [prompts, setPrompts] = useState<PromptNodeType[]>(() => {
    if (Array.isArray(messages) && messages.length > 0) {
      return messages.map(msg => ({
        id: nanoid(6),
        role: msg.role || 'user',
        content: msg.content || '',
      }));
    }

    // 默认消息
    return [
      { id: nanoid(6), role: 'system', content: 'You are an AI' },
      { id: nanoid(6), role: 'user', content: 'Answer the question' },
    ];
  });

  // 只有当messages引用真正变化且内容不同时才更新内部状态
  useEffect(() => {
    // 检查内容是否真的变化了
    const isSameContent =
      messagesRef.current.length === messages.length &&
      messagesRef.current.every((oldMsg, i) => {
        const newMsg = messages[i];
        return oldMsg.role === newMsg.role && oldMsg.content === newMsg.content;
      });

    if (!isSameContent) {
      messagesRef.current = messages;
      if (Array.isArray(messages) && messages.length > 0) {
        setPrompts(
          messages.map(msg => ({
            id: nanoid(6),
            role: msg.role,
            content: msg.content,
          }))
        );
      }
    }
  }, [messages]);

  // 避免频繁触发onChange的防抖 - 使用更长的延迟
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isEditingRef = useRef(false); // 跟踪是否正在编辑

  // 当prompts变化时通知父组件，使用防抖减少更新频率
  useEffect(() => {
    // 清除之前的timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // 不在编辑过程中时才触发更新
    if (!isEditingRef.current) {
      // 500ms防抖，降低更新频率
      timeoutRef.current = setTimeout(() => {
        const updatedMessages = prompts.map(({ role, content }) => ({
          role,
          content,
        }));

        // 检查是否有实际变化
        const hasChanged =
          updatedMessages.length !== messagesRef.current.length ||
          updatedMessages.some((msg, i) => {
            const oldMsg = messagesRef.current[i];
            return (
              !oldMsg ||
              msg.role !== oldMsg.role ||
              msg.content !== oldMsg.content
            );
          });

        if (hasChanged) {
          messagesRef.current = updatedMessages;
          onChange(updatedMessages);
        }
      }, 500);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [prompts, onChange]);

  // 提示编辑函数
  const addNode = useCallback(() => {
    setPrompts(prev => [
      ...prev,
      {
        id: nanoid(6),
        role: 'user',
        content: '',
      },
    ]);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setPrompts(prev => prev.filter(node => node.id !== nodeId));
  }, []);

  const updateNodeContent = useCallback((nodeId: string, content: string) => {
    setPrompts(prev =>
      prev.map(node => (node.id === nodeId ? { ...node, content } : node))
    );
  }, []);

  const updateNodeRole = useCallback((nodeId: string, role: PromptRole) => {
    setPrompts(prev =>
      prev.map(node => (node.id === nodeId ? { ...node, role } : node))
    );
  }, []);

  // 修改渲染提示节点的方法，解决闪烁问题，移除内部的useMemo
  const renderPromptNode = (node: PromptNodeType) => {
    // 为每个节点创建一个独立的输入事件处理函数
    const handleFocus = () => {
      isEditingRef.current = true;
      onFocus && onFocus();
    };

    const handleBlur = () => {
      isEditingRef.current = false;
      onBlur && onBlur();

      // 失焦时触发一次更新，确保变更保存
      const updatedMessages = prompts.map(({ role, content }) => ({
        role,
        content,
      }));
      messagesRef.current = updatedMessages;
      onChange(updatedMessages);
    };

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      // 自动调整高度
      const target = e.target as HTMLTextAreaElement;
      target.style.height = 'auto';
      target.style.height = `${target.scrollHeight}px`;
    };

    // 使用普通函数而不是hook计算高亮内容
    const highlightedContent = getHighlightedContent(node.content, variables);

    return (
      <div key={node.id} className='relative group mb-1'>
        <div className='flex items-start gap-2'>
          <div className='flex-1 relative min-h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors overflow-hidden'>
            {/* 角色选择器 */}
            <div
              className={`absolute left-[6px] top-[8px] h-[20px] flex items-center 
                            px-2 rounded-[4px] cursor-pointer transition-colors z-30 bg-[#252525] border border-[#6D7177]/30 hover:border-[#6D7177]/50`}
              onClick={() => {
                const roles: PromptRole[] = ['system', 'user', 'assistant'];
                const currentIndex = roles.indexOf(node.role);
                const nextRole = roles[(currentIndex + 1) % roles.length];
                updateNodeRole(node.id, nextRole);
              }}
            >
              <div
                className={`text-[10px] font-semibold min-w-[24px] text-center text-[#CDCDCD]`}
              >
                {node.role}
              </div>
            </div>

            {/* 输入层 - 使文本显示但保持输入状态 */}
            <textarea
              value={node.content}
              onChange={e => updateNodeContent(node.id, e.target.value)}
              className='w-full bg-transparent border-none outline-none pl-[80px] pr-2 py-2
                            text-[#CDCDCD] text-[12px] appearance-none resize-y min-h-[32px] nodrag'
              placeholder='Enter message content...'
              rows={1}
              onMouseDown={e => e.stopPropagation()}
              onInput={handleInput}
              onFocus={handleFocus}
              onBlur={handleBlur}
              style={{ caretColor: '#CDCDCD' }}
            />

            {/* 高亮层 - 仅用于高亮显示变量 */}
            <div
              className='absolute inset-0 pl-[80px] pr-2 py-2 pointer-events-none 
                            text-[12px] overflow-hidden whitespace-pre-wrap break-words'
              dangerouslySetInnerHTML={{ __html: highlightedContent }}
            />
          </div>

          <button
            onClick={() => deleteNode(node.id)}
            className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors mt-[4px]'
          >
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
            >
              <path
                d='M18 6L6 18M6 6l12 12'
                strokeWidth='2'
                strokeLinecap='round'
              />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
      {prompts.length === 0 ? (
        <button
          onClick={() =>
            setPrompts([
              { id: nanoid(6), role: 'system', content: 'You are an AI' },
            ])
          }
          className='w-full h-[32px] flex items-center justify-center gap-2 rounded-[6px] 
                    border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] text-[12px] font-medium 
                    hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] transition-colors'
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='#6D7177'
          >
            <path d='M12 5v14M5 12h14' strokeWidth='2' strokeLinecap='round' />
          </svg>
          Create First Message
        </button>
      ) : (
        <div className='flex flex-col gap-1'>
          {prompts.map(renderPromptNode)}

          {/* Add button */}
          <div className='flex items-center mt-1'>
            <button
              onClick={addNode}
              className='w-6 h-6 flex items-center justify-center rounded-md
                            bg-[#252525] border-[1px] border-[#6D7177]/30
                            text-[#6D7177]
                            hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                            transition-colors'
            >
              <svg width='10' height='10' viewBox='0 0 14 14'>
                <path
                  d='M7 0v14M0 7h14'
                  stroke='currentColor'
                  strokeWidth='2'
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptEditor;
