import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkspace: (template?: any, name?: string) => void;
  workspaceTemplates: any;
}

const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
  isOpen,
  onClose,
  onCreateWorkspace,
  workspaceTemplates,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Handle fade in/out animation
  useEffect(() => {
    setIsAnimating(true);
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
    const timer = setTimeout(() => setIsAnimating(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleClose = () => {
    setIsAnimating(true);
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300); // Wait for fade out animation to complete
  };

  const canInteract = isVisible && !isAnimating;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleCreateOption = (type: string, template?: any, name?: string) => {
    switch (type) {
      case 'empty':
        onCreateWorkspace(undefined, 'Untitled Workspace');
        break;
      case 'database':
        onCreateWorkspace(undefined, 'Database Workspace');
        break;
      case 'ai':
        onCreateWorkspace(workspaceTemplates?.onboarding_guide?.content, 'AI Assistant');
        break;
      case 'template':
        onCreateWorkspace(template, name);
        break;
      default:
        onCreateWorkspace();
    }
    handleClose();
  };

  const mainOption = {
    id: 'empty',
    icon: (
      <svg className='w-5 h-5' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
        <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
        <polyline points='14,2 14,8 20,8' />
      </svg>
    ),
    title: 'Empty workspace',
    description: 'Start with a blank workspace',
  };

  const suggestedTemplates = [
    {
      id: 'getting-started',
      icon: '🎓',
      title: 'Getting Started',
      description: 'Learn the basics with guided tutorials.',
      template: workspaceTemplates?.onboarding_guide,
      name: 'Getting Started',
    },
    {
      id: 'rag-chatbot',
      icon: '🤖',
      title: 'RAG Chatbot',
      description: 'AI assistant based on your documents.',
      template: workspaceTemplates?.agentic_rag,
      name: 'RAG Chatbot',
    },
    {
      id: 'cms-manager',
      icon: '📝',
      title: 'CMS Manager',
      description: 'Simple content management system.',
      template: workspaceTemplates?.article_writer,
      name: 'CMS Manager',
    },
    {
      id: 'personal-rss',
      icon: '📡',
      title: 'Personal RSS',
      description: 'Your personalized news and content feed.',
      template: workspaceTemplates?.personal_rss,
      name: 'Personal RSS',
    },
  ];


  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div className={`fixed inset-0 flex items-center justify-center z-[9999] transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm" />
      
      {/* Modal */}
      <div
        ref={modalRef}
        className={`relative bg-[#2A2A2A] rounded-[12px] shadow-2xl border border-[#404040] max-w-[800px] w-full mx-6 max-h-[600px] overflow-hidden flex flex-col transition-all duration-300 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} ${canInteract ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >

        {/* Fixed Top Section - Main Option */}
        <div className="flex-shrink-0 text-[13px] text-[#D4D4D4] flex justify-center pt-16 pb-6">
          <div className="w-[576px] px-0">
            <div className="w-1/3">
              <button
                onClick={() => handleCreateOption('empty')}
                disabled={!canInteract}
                className="w-full flex flex-col items-start gap-3 px-[16px] py-[18px] bg-transparent hover:bg-[#1A1A1A] border border-[#404040] hover:border-[#505050] rounded-[12px] transition-all duration-200 group disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
              >
                <div className="text-[#9CA3AF] group-hover:text-[#E5E5E5] transition-colors">
                  {mainOption.icon}
                </div>
                <div className="text-left">
                  <div className="text-[12px] font-medium text-[#E5E5E5]">
                    {mainOption.title}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Bottom Section - Suggested Templates */}
        <div 
          className="flex-1 overflow-y-auto text-[13px] text-[#D4D4D4] flex justify-center"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#6B7280 transparent'
          }}
        >
          <div className="w-[576px] px-0">
            <div className="pb-4">
              <h3 className="text-[12px] font-medium text-[#9CA3AF] mb-4">
                Templates
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {suggestedTemplates.map((template) => (
                <button
                  key={template.id}
                onClick={() => handleCreateOption('template', template.template, template.name)}
                disabled={!canInteract}
                className="flex flex-col p-4 bg-transparent hover:bg-[#1A1A1A] border border-[#404040] hover:border-[#505050] rounded-[12px] transition-all duration-200 text-left group h-[120px] disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none"
                >
                  <div className="mb-[4px]">
                    <div className="text-[12px] font-medium text-[#E5E5E5]">
                      {template.title}
                    </div>
                  </div>
                  <div className="text-[12px] text-[#9CA3AF] leading-relaxed flex-1">
                    {template.description}
                  </div>
                  
                  {/* Template Preview Area */}
                  <div className="mt-3 h-8 bg-[#1F1F1F] rounded-[12px] border border-[#333] flex items-center justify-center">
                    <div className="flex gap-1">
                      <div className="w-1 h-1 bg-[#404040] rounded-full"></div>
                      <div className="w-1 h-1 bg-[#404040] rounded-full"></div>
                      <div className="w-1 h-1 bg-[#404040] rounded-full"></div>
                    </div>
                  </div>
                </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CreateWorkspaceModal;

