import * as React from 'react';
import { ipc } from '@/lib/ipc';

interface NotificationData {
  title: string;
  time: string;
  meeting_url?: string;
  attendees?: string;
}

export function NotificationToast() {
  const [data, setData] = React.useState<NotificationData | null>(null);

  React.useLayoutEffect(() => {
    const off = ipc().on.showNotification((newData) => {
      setData(newData);
    });
    return off;
  }, []);

  if (!data) return null;

  const handleClose = () => {
    ipc().notification.close();
  };

  const handleJoin = () => {
    if (data.meeting_url) {
      ipc().shell.openExternal(data.meeting_url);
    }
    handleClose();
  };

  // Generate a consistent, professional color based on the meeting title
  const getEventColor = (title: string) => {
    const colors = ['#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#06B6D4'];
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const barColor = getEventColor(data.title);

  return (
    <>
      <style>{`
        html, body, #root {
          background: transparent !important;
        }
      `}</style>
      <div className="flex h-screen w-screen items-center justify-center bg-transparent p-3">
        <div 
        className="group relative flex w-full items-center justify-between rounded-[20px] bg-white p-2.5 pr-3 border border-gray-200 dark:bg-[#1E1E1E] dark:border-white/10"
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      >
        {/* Close Button (Hidden until hover) */}
        <button
          onClick={handleClose}
          className="absolute -top-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm border border-gray-200 text-gray-500 opacity-0 transition-opacity hover:bg-gray-50 hover:text-gray-700 group-hover:opacity-100 dark:bg-[#2C2C2E] dark:border-white/10 dark:text-gray-400 dark:hover:bg-[#3C3C3E] dark:hover:text-gray-200"
          title="Close"
        >
          <svg width="8" height="8" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Left Side: Status Line + Text */}
        <div className="flex items-center">
          <div 
            className="h-8 w-1 rounded-full ml-1 shrink-0" 
            style={{ backgroundColor: barColor }}
          ></div>
          <div className="flex flex-col justify-center ml-3">
            <span className="text-[14px] font-medium text-gray-900 tracking-tight leading-tight truncate max-w-[150px] dark:text-gray-100">
              {data.title}
            </span>
            <span className="text-[12px] font-normal text-gray-500 leading-tight mt-0.5 dark:text-gray-400">
              {data.time}
            </span>
          </div>
        </div>

        {/* Right Side: Action Button */}
        {data.meeting_url && (
          <button
            onClick={handleJoin}
            className="flex items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-900 transition-all hover:bg-gray-50 hover:shadow-sm active:bg-gray-100 active:scale-[0.98] shrink-0 dark:border-white/10 dark:bg-[#2C2C2E] dark:text-gray-100 dark:hover:bg-[#3C3C3E] dark:active:bg-[#1C1C1E]"
          >
            <ProfessionalCameraIcon className="h-5 w-5" backgroundColor={barColor} />
            <span>Join & take notes</span>
          </button>
        )}
      </div>
    </div>
    </>
  );
}

function ProfessionalCameraIcon({ className, backgroundColor = '#10B981' }: { className?: string, backgroundColor?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="5.5" fill={backgroundColor}/>
      <path d="M15.5 10.5V8C15.5 7.17157 14.8284 6.5 14 6.5H6C5.17157 6.5 4.5 7.17157 4.5 8V16C4.5 16.8284 5.17157 17.5 6 17.5H14C14.8284 17.5 15.5 16.8284 15.5 16V13.5L19.5 16.5V7.5L15.5 10.5Z" fill="white"/>
    </svg>
  );
}
