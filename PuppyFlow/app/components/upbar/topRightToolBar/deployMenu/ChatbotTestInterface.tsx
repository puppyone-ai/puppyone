import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { SYSTEM_URLS } from '@/config/urls';
import { ChatInterface } from 'puppychat';

interface ChatbotTestInterfaceProps {
  apiEndpoint: string;
  chatbotId: string;
  apiKey?: string;
  onClose?: () => void;
  input?: string;
  output?: string;
  history?: string;
}

const ChatbotTestInterface = ({
  apiEndpoint,
  chatbotId,
  apiKey,
  onClose,
  input,
  output,
  history
}: ChatbotTestInterfaceProps) => {
  const [userApiKey, setUserApiKey] = useState<string>(apiKey || '');
  const [conversationHistory, setConversationHistory] = useState<string>('');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }

      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  const handleSendMessage = async (message: string): Promise<string> => {
    if (!input) {
      return 'Error: Input node is not configured. Please configure the input node before testing.';
    }

    try {
      const API_SERVER_URL = SYSTEM_URLS.API_SERVER.BASE;
      const finalApiEndpoint = `${API_SERVER_URL}/chat/${chatbotId}`;

      const requestData: any = {
        input: {
          [input]: message
        }
      };

      if (history) {
        requestData.history = {
          [history]: conversationHistory
        };
      }

      console.log('Sending request:', requestData);
      console.log('History node ID:', history);
      console.log('Conversation history content:', conversationHistory);

      const response = await axios.post(finalApiEndpoint, requestData, {
        headers: {
          "Authorization": userApiKey ? `Bearer ${userApiKey}` : '',
          "Content-Type": "application/json"
        }
      });

      console.log('Received response:', response.data);

      let botResponse = "No response from the bot";

      if (response.data?.output) {
        if (output && response.data.output[output]) {
          botResponse = response.data.output[output];
        } else {
          const outputKeys = Object.keys(response.data.output);
          if (outputKeys.length > 0) {
            botResponse = response.data.output[outputKeys[0]];
          }
        }
      }

      // 更新对话历史
      if (history) {
        const newHistoryEntry = `User: ${message}\nAssistant: ${botResponse}\n`;
        setConversationHistory(prev => prev + newHistoryEntry);
        console.log('Updated conversation history:', conversationHistory + newHistoryEntry);
      }

      return botResponse;

    } catch (error: any) {
      console.error("Error calling chatbot API:", error);

      let errorContent = "Failed to connect to the API";

      if (error.response?.data) {
        if (typeof error.response.data === 'string') {
          errorContent = error.response.data;
        } else if (error.response.data.message) {
          errorContent = error.response.data.message;
        } else if (error.response.data.detail) {
          errorContent = error.response.data.detail;
        }
      } else if (error.message) {
        errorContent = error.message;
      }

      return `Error: ${errorContent}`;
    }
  };

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  // API Key 配置区域组件
  const ApiKeySection = () => (
    <div className="mb-4" onClick={stopPropagation}>
      <div className="flex items-center justify-between text-[11px] text-[#505050] mb-2">
        <div className="flex items-center">
          <span>API Key: <span className={userApiKey ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}>
            {userApiKey ? 'Configured' : 'Not configured'}
          </span></span>
        </div>
      </div>
      <div className="relative">
        <input
          type="password"
          value={userApiKey}
          onChange={(e) => {
            stopPropagation(e);
            setUserApiKey(e.target.value);
          }}
          placeholder="Enter your API key..."
          className="w-full p-2 rounded bg-[#202020] text-white border border-[#404040] focus:outline-none focus:border-[#2DFF7C] transition-all placeholder:text-[#606060] text-xs"
          onClick={stopPropagation}
        />
      </div>
    </div>
  );

  // 状态信息区域组件
  const StatusSection = () => (
    <>
      <div className="mt-4 flex items-center justify-between text-[11px] text-[#505050]">
        <div className="flex items-center">
          <span>Chatbot ID: <span className="text-[#606060]">{chatbotId}</span></span>
        </div>
        <div className="flex items-center">
          <span>Endpoint: <span className="text-[#606060] hover:text-[#2D7CFF] transition-colors">
            /chat/{chatbotId}
          </span></span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[#505050]">
        <div className="flex items-center">
          <span>Input Node: <span className={input ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}>
            {input || 'Not configured'}
          </span></span>
        </div>
        <div className="flex items-center">
          <span>Output Node: <span className={output ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}>
            {output || 'Not configured'}
          </span></span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[#505050]">
        <div className="flex items-center">
          <span>History Node: <span className={history ? "text-[#2DFF7C]" : "text-[#606060]"}>
            {history || 'Not configured (optional)'}
          </span></span>
        </div>
      </div>
    </>
  );

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[9999]"
      onKeyDown={stopPropagation}
      onKeyUp={stopPropagation}
      onKeyPress={stopPropagation}
      onClick={stopPropagation}
    >
      <div
        className="absolute inset-0 bg-black bg-opacity-80 backdrop-blur-sm"
        onClick={(e) => {
          stopPropagation(e);
          onClose && onClose();
        }}
      ></div>

      <div
        ref={modalRef}
        className="relative bg-transparent rounded-xl shadow-2xl max-w-2xl w-full mx-6 z-[10000]  overflow-hidden"
        onClick={stopPropagation}
        onKeyDown={stopPropagation}
        onKeyUp={stopPropagation}
        onKeyPress={stopPropagation}
      >


        <div
          className="bg-transparent from-[#1E1E1E] to-[#252525] rounded-lg p-6 shadow-xl"
          onClick={stopPropagation}
        >


          {/* 使用你的 ChatInterface 组件 */}
          <div className="mb-4">
            <ChatInterface
              onSendMessage={handleSendMessage}
              title="PuppyChat Test"
              placeholder={input ? "Type your message here..." : "Configure input node first..."}
              welcomeMessage="Welcome to your chatbot test interface! Start chatting to test your deployed bot."
              width="100%"
              height="600px"
              showAvatar={true}
              disabled={!input}
              recommendedQuestions={[
              ]}
            />
          </div>
          
          {/* 配置信息区域 */}
          <div className="bg-[#1A1A1A] rounded-lg border border-[#333] p-4">
            <ApiKeySection />
            <StatusSection />
          </div>
        </div>

      </div>
    </div>
  );
};

export default ChatbotTestInterface;
<style jsx>{`
  .typing-indicator {
    display: flex;
    align-items: center;
    height: 24px;
  }
  
  .typing-indicator span {
    height: 8px;
    width: 8px;
    margin: 0 2px;
    background-color: #2DFF7C;
    display: block;
    border-radius: 50%;
    opacity: 0.5;
  }
  
  .typing-indicator span:nth-child(1) {
    animation: pulse 0.8s infinite;
  }
  
  .typing-indicator span:nth-child(2) {
    animation: pulse 0.8s infinite 0.2s;
  }
  
  .typing-indicator span:nth-child(3) {
    animation: pulse 0.8s infinite 0.4s;
  }
  
  @keyframes pulse {
    0% {
      opacity: 0.5;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.3);
    }
    100% {
      opacity: 0.5;
      transform: scale(1);
    }
  }

  @keyframes blink {
    0%, 100% {
      opacity: 0.2;
    }
    50% {
      opacity: 1;
    }
  }

  .animate-blink-1 {
    animation: blink 1.2s ease-in-out infinite;
  }

  .animate-blink-2 {
    animation: blink 1.2s ease-in-out infinite 0.4s;
  }

  .animate-blink-3 {
    animation: blink 1.2s ease-in-out infinite 0.8s;
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 10px;
    height: 10px;
    display: block;
  }
  
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #1a1a1a;
    border-radius: 4px;
    display: block;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 4px;
    display: block;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #555;
    cursor: pointer;
  }

  /* 确保在所有浏览器中都显示滚动条 */
  .custom-scrollbar {
    -ms-overflow-style: scrollbar; /* IE and Edge */
    scrollbar-width: thin; /* Firefox */
    scrollbar-color: #444 #1a1a1a; /* Firefox */
    overflow-y: scroll !important; /* 强制始终显示滚动条 */
  }
`}</style> 
