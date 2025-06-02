'use client'
import Sidebar from "./components/sidebar/Sidebar";
import Workflow from "./components/workflow/Workflow";
import React from "react";
import { ReactFlowProvider } from '@xyflow/react'
import { NodesPerFlowContextProvider } from "./components/states/NodesPerFlowContext";
import { FlowsPerUserContextProvider, useFlowsPerUserContext } from "./components/states/FlowsPerUserContext";
import BlankWorkspace from "./components/blankworkspace/BlankWorkspace";
import { AppSettingsProvider } from "./components/states/AppSettingsContext";
import Link from 'next/link';

function InviteCodeVerification({ onVerificationSuccess }: { onVerificationSuccess: () => void }) {
  const [inviteCode, setInviteCode] = React.useState("");
  const [isChecking, setIsChecking] = React.useState(false);
  const [error, setError] = React.useState("");

  const validateInviteCode = async () => {
    if (!inviteCode.trim()) {
      setError("Please enter your invite code");
      return;
    }

    setIsChecking(true);
    setError("");

    try {
      // 添加随机延时
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));

      const number = parseInt(inviteCode);
      if (isNaN(number)) {
        setError("Your invite code is invalid");
        return;
      }

      // 检查是否能被 15629 整除
      if (number % 15629 === 0) {
        setError("");
        onVerificationSuccess();
      } else {
        setError("Invalid invite code");
      }
    } catch (error) {
      setError("Error verifying invite code");
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen" style={{ backgroundColor: '#1C1D1F', color: 'white' }}>
      <div className="absolute" style={{ top: '13px', left: '27px', fontSize: '19.2px', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 'bold' }}>
        <span style={{ color: '#4599DF' }}>Puppy</span>
        <span style={{ color: '#FFA73D' }}>Agent</span>
      </div>
      <div className="w-full max-w-[400px] px-4 sm:px-0" style={{ height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="flex flex-col justify-between w-full text-center">
          <h1 style={{ marginBottom: '48px', fontFamily: 'JetBrains Mono, monospace', fontSize: '28px', fontWeight: 'bold', color: '#CDCDCD' }}>
            Sign in to your account
          </h1>
          <div className="flex flex-col space-y-4 gap-[16px]">
            <div className="flex space-x-2 h-[40px]">
              <div className="flex-grow relative">
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Please enter your invite code"
                  className="w-full h-[40px] rounded-xl bg-[#1C1D1F] text-[#D6DDE6] border-[1.5px] border-[#4599DF] placeholder-[#8B8B8B]"
                  style={{
                    padding: '8px 8px',
                    fontSize: '14px',
                    lineHeight: '15px',
                    fontFamily: 'Plus Jakarta Sans, sans-serif',
                    fontWeight: 'regular',
                    outline: 'none'
                  }}
                />
              </div>
              <button
                onClick={validateInviteCode}
                disabled={isChecking}
                className="whitespace-nowrap rounded-xl border-[1.5px] border-[#4599DF] bg-[#1C1D1F] text-[#D6DDE6] hover:bg-[#4599DF] hover:text-black disabled:opacity-50 disabled:hover:bg-[#1C1D1F] disabled:hover:text-[#D6DDE6] relative"
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  lineHeight: '15px',
                  fontFamily: 'Plus Jakarta Sans, sans-serif',
                  fontWeight: 'regular',
                  marginLeft: '16px',
                  transition: 'all 200ms ease-in-out'
                }}
              >
                {isChecking ? (
                  <div className="flex items-center">
                    <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Verifying...
                  </div>
                ) : (
                  "Verify"
                )}
              </button>
            </div>
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <p className="text-center" style={{ 
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              fontSize: '12px',
              color: '#8B8B8B',
            }}>
              or get an invite code by joining the waiting list
            </p>
            
            <div className="flex justify-center w-full">
              <Link href="https://puppyagent.notion.site/12bbbe13bfbb80abb624ee5788a6f629?pvs=105" className="max-w-[188px]">
                  <div className="max-w-[188px] px-[16px] py-[8px] bg-[#252628] text-white border-[1px] border-[#494A4C] 
                      rounded-[8px] cursor-pointer font-plus-jakarta font-[300] 
                      transition-all duration-200 ease-in-out
                      hover:text-white hover:bg-[#494A4C]
                      xs:px-[8px] xs:py-[4px]">
                      <div className="text-[14px] width-auto font-[300] tracking-0 leading-[20px] text-center xs:text-[14px]">
                          Join the waiting list
                      </div>
                  </div>
              </Link>
            </div>

            <p className="text-center text-xs" style={{ color: '#8B8B8B' }}>
              By signing in, you agree to our{' '}
              <a
                href="https://www.puppyagent.com/terms"
                className="text-[#4599DF] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >Terms of Service</a>
              {' '}and{' '}
              <a
                href="https://www.puppyagent.com/privacy"
                className="text-[#4599DF] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >Privacy Policy</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveFlowContent() {
  const { selectedFlowId } = useFlowsPerUserContext();
  return selectedFlowId ? <Workflow /> : <BlankWorkspace />;
}

function MainApplication() {
  return (
    <div id="home" className="w-screen h-screen flex flex-row bg-[#131313] overflow-hidden">
      <AppSettingsProvider>
        <ReactFlowProvider>
          <FlowsPerUserContextProvider>
            <>
              <Sidebar />
              <NodesPerFlowContextProvider>
                <ActiveFlowContent />
              </NodesPerFlowContextProvider>
            </>
          </FlowsPerUserContextProvider>
        </ReactFlowProvider>
      </AppSettingsProvider>
    </div>
  );
}

export default function Home() {
  const [isVerified, setIsVerified] = React.useState(false);

  const handleVerificationSuccess = () => {
    setIsVerified(true);
  };

  return isVerified ? (
    <MainApplication />
  ) : (
    <InviteCodeVerification onVerificationSuccess={handleVerificationSuccess} />
  );
}
