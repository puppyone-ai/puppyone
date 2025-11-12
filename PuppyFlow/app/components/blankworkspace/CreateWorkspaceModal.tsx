import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import emptyPageTemplate from './templete/emptypage.json';
import finalGetStartedContent from './templete/finalgetstarted.json';
import ragChatbotContent from './templete/RAG templete.json';
import fileLoadContent from './templete/file load.json';
import articleWriterContent from './templete/article_writer.json';
import seoBlogContent from './templete/seo blog.json';

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateWorkspace: (template?: any, name?: string) => void;
  onCreateWorkspaceFromTemplate?: (templateId: string, name: string) => void;
  workspaceTemplates: any;
}

const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
  isOpen,
  onClose,
  onCreateWorkspace,
  onCreateWorkspaceFromTemplate,
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

  const handleCreateOption = (
    type: string,
    template?: any,
    name?: string,
    templateId?: string
  ) => {
    handleClose();

    if (templateId && onCreateWorkspaceFromTemplate) {
      // Use new template instantiation API
      onCreateWorkspaceFromTemplate(templateId, name || 'Untitled Workspace');
    } else {
      // Use old flow for backward compatibility
      switch (type) {
        case 'empty':
          onCreateWorkspace(emptyPageTemplate as any, 'Untitled Context Base');
          break;
        case 'template':
          onCreateWorkspace(template, name);
          break;
        default:
          onCreateWorkspace();
      }
    }
  };

  const mainOption = {
    id: 'empty',
    title: 'Empty context base',
    description: 'Start with a blank context base',
  };

  const suggestedTemplates = [
    {
      id: 'getting-started',
      templateId: 'getting-started',
      title: workspaceTemplates?.onboarding_guide?.title || 'Getting Started',
      description:
        workspaceTemplates?.onboarding_guide?.description ||
        'Learn the basics with guided tutorials.',
      content: finalGetStartedContent,
      name: 'Getting Started',
    },
    {
      id: 'rag-chatbot',
      templateId: 'agentic-rag',
      title: workspaceTemplates?.rag_chatbot?.title || 'for RAG Chatbot',
      description:
        workspaceTemplates?.rag_chatbot?.description ||
        'AI assistant based on your documents.',
      content: ragChatbotContent,
      name: 'RAG Chatbot',
    },
    {
      id: 'file content extraction',
      templateId: 'file-load',
      title:
        workspaceTemplates?.file_content_extraction?.title ||
        'for File Extraction and Ingestion',
      description:
        workspaceTemplates?.file_content_extraction?.description ||
        'Extract file contents and ingest them into your knowledge base.',
      content: fileLoadContent,
      name: 'File Content Extraction',
    },
    {
      id: 'seo',
      templateId: 'seo-blog',
      title: workspaceTemplates?.seo?.title || 'for SEO Blog Generator',
      description:
        workspaceTemplates?.seo?.description ||
        'Generate and optimize SEO content with automated workflows.',
      content: seoBlogContent,
      name: 'SEO',
    },
  ];

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center z-[9999] transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Backdrop */}
      <div className='absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm' />

      {/* Modal */}
      <div
        ref={modalRef}
        className={`relative bg-[#2A2A2A] rounded-[12px] shadow-2xl border border-[#404040] max-w-[800px] w-full mx-6 max-h-[600px] overflow-hidden flex flex-col transition-all duration-300 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} ${canInteract ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        {/* Fixed Top Section - Main Option */}
        <div className='flex-shrink-0 text-[13px] text-[#D4D4D4] flex justify-center pt-16 pb-6'>
          <div className='w-[576px] px-0'>
            <div className='w-1/3'>
              <button
                onClick={() => handleCreateOption('empty')}
                disabled={!canInteract}
                className='w-full flex flex-col items-start gap-3 px-[16px] py-[18px] bg-transparent hover:bg-[#1A1A1A] border border-[#404040] hover:border-[#505050] rounded-[12px] transition-all duration-200 group disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none'
              >
                <div className='text-left'>
                  <img
                    src={'/templetepicture/Group 1035.svg'}
                    alt='Empty Context Base Icon'
                    className='w-[16px] h-[16px] mb-4 opacity-100'
                    draggable={false}
                  />
                  <div className='text-[12px] font-medium text-[#E5E5E5]'>
                    {mainOption.title}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Bottom Section - Suggested Templates */}
        <div
          className='flex-1 overflow-y-auto text-[13px] text-[#D4D4D4] flex justify-center'
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#6B7280 transparent',
          }}
        >
          <div className='w-[576px] px-0'>
            <div className='pb-4'>
              <h3 className='text-[12px] font-medium text-[#9CA3AF] mb-4'>
                Context Templates
              </h3>
              <div className='grid grid-cols-2 gap-4'>
                {suggestedTemplates.map(template => (
                  <button
                    key={template.id}
                    onClick={() =>
                      handleCreateOption(
                        'template',
                        template.content,
                        template.name,
                        template.templateId
                      )
                    }
                    disabled={!canInteract}
                    className='flex flex-col p-4 bg-transparent hover:bg-[#1A1A1A] border border-[#404040] hover:border-[#505050] rounded-[12px] transition-all duration-200 text-left group disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none'
                  >
                    <div className='mb-[4px]'>
                      <div className='text-[12px] font-medium text-[#E5E5E5]'>
                        {template.title}
                      </div>
                    </div>
                    <div className='text-[12px] text-[#9CA3AF] leading-relaxed flex-1'>
                      {template.description}
                    </div>

                    {/* Template Preview Area */}
                    <div
                      className={`mt-3 bg-[#1F1F1F] rounded-[12px] border border-[#333] flex items-center justify-center overflow-hidden w-[244px] ${template.id === 'rag-chatbot' || template.id === 'seo' || template.id === 'file content extraction' ? 'h-auto' : 'h-[130px]'} mx-auto`}
                    >
                      {template.id === 'getting-started' ? (
                        <img
                          src={'/templetepicture/get started screen.png'}
                          alt='Getting Started Preview'
                          className='w-full h-full object-contain select-none'
                          loading='lazy'
                          draggable={false}
                        />
                      ) : template.id === 'rag-chatbot' ? (
                        <img
                          src={'/templetepicture/RAG.png'}
                          alt='Agentic RAG Preview'
                          className='w-full h-auto object-contain select-none'
                          loading='lazy'
                          draggable={false}
                        />
                      ) : template.id === 'seo' ? (
                        <img
                          src={'/templetepicture/SEO blog.png'}
                          alt='SEO Blog Preview'
                          className='w-full h-auto object-contain select-none'
                          loading='lazy'
                          draggable={false}
                        />
                      ) : template.id === 'file content extraction' ? (
                        <img
                          src={'/templetepicture/fileload.png'}
                          alt='File Content Extraction Preview'
                          className='w-full h-auto object-contain select-none'
                          loading='lazy'
                          draggable={false}
                        />
                      ) : (
                        <div className='flex gap-1'>
                          <div className='w-1 h-1 bg-[#404040] rounded-full'></div>
                          <div className='w-1 h-1 bg-[#404040] rounded-full'></div>
                          <div className='w-1 h-1 bg-[#404040] rounded-full'></div>
                        </div>
                      )}
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
