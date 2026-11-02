import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, Loader2 } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // 0 for persistent
  progress?: number; // 0-100 for progress toasts
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onDismiss(toast.id), 200);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onDismiss]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />,
    loading: <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />,
  };

  const borderColors = {
    success: 'border-green-500/30',
    error: 'border-red-500/30',
    warning: 'border-yellow-500/30',
    info: 'border-blue-500/30',
    loading: 'border-violet-500/30',
  };

  const bgColors = {
    success: 'bg-green-500/5',
    error: 'bg-red-500/5',
    warning: 'bg-yellow-500/5',
    info: 'bg-blue-500/5',
    loading: 'bg-violet-500/5',
  };

  return (
    <div
      className={`relative flex items-start gap-3 p-4 rounded-xl border backdrop-blur-md shadow-2xl transition-all duration-200 min-w-[320px] max-w-[400px] ${
        borderColors[toast.type]
      } ${bgColors[toast.type]} bg-[#161b22]/95 ${
        isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
      }`}
    >
      <div className="shrink-0 mt-0.5">{icons[toast.type]}</div>

      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-white text-sm">{toast.title}</h4>
        {toast.message && (
          <p className="text-gray-400 text-xs mt-1 leading-relaxed">{toast.message}</p>
        )}

        {/* Progress Bar */}
        {toast.type === 'loading' && typeof toast.progress === 'number' && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>Progress</span>
              <span>{Math.round(toast.progress)}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full transition-all duration-300"
                style={{ width: `${toast.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {toast.type !== 'loading' && (
        <button
          onClick={() => {
            setIsExiting(true);
            setTimeout(() => onDismiss(toast.id), 200);
          }}
          className="shrink-0 p-1 text-gray-500 hover:text-white rounded-md hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onDismissAll?: () => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss, onDismissAll }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  
  if (toasts.length === 0) return null;

  // Count loading toasts
  const loadingCount = toasts.filter(t => t.type === 'loading').length;
  const otherCount = toasts.length - loadingCount;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2">
      {/* Header with minimize/dismiss all when multiple toasts */}
      {toasts.length > 1 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#161b22]/95 backdrop-blur-md border border-gray-700/50 rounded-xl shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">
              {loadingCount > 0 && (
                <span className="text-violet-400">{loadingCount} generating</span>
              )}
              {loadingCount > 0 && otherCount > 0 && <span className="mx-1">•</span>}
              {otherCount > 0 && (
                <span>{otherCount} notification{otherCount > 1 ? 's' : ''}</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="px-2 py-1 text-[10px] font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              {isMinimized ? 'Expand' : 'Minimize'}
            </button>
            {onDismissAll && (
              <button
                onClick={onDismissAll}
                className="px-2 py-1 text-[10px] font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                Dismiss All
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Toast list */}
      {!isMinimized && (
        <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
        </div>
      )}
      
      {/* Minimized summary */}
      {isMinimized && loadingCount > 0 && (
        <div className="px-4 py-3 bg-[#161b22]/95 backdrop-blur-md border border-violet-500/30 rounded-xl shadow-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
            <span className="text-sm text-gray-300">
              Generating {loadingCount * 2} images...
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// Hook for managing toasts
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const dismissAll = () => {
    setToasts([]);
  };

  const updateToast = (id: string, updates: Partial<Toast>) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  // Convenience methods
  const success = (title: string, message?: string, duration = 4000) =>
    addToast({ type: 'success', title, message, duration });

  const error = (title: string, message?: string, duration = 6000) =>
    addToast({ type: 'error', title, message, duration });

  const warning = (title: string, message?: string, duration = 5000) =>
    addToast({ type: 'warning', title, message, duration });

  const info = (title: string, message?: string, duration = 4000) =>
    addToast({ type: 'info', title, message, duration });

  const loading = (title: string, message?: string) =>
    addToast({ type: 'loading', title, message, duration: 0, progress: 0 });

  return {
    toasts,
    addToast,
    dismissToast,
    dismissAll,
    updateToast,
    success,
    error,
    warning,
    info,
    loading,
  };
};
